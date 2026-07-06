from __future__ import annotations

from datetime import timedelta

from django.db import transaction
from django.db.models import Q
from django.http import FileResponse, Http404, HttpResponse
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.simulations.models import Simulation, SimulationStatus

from .dashboard_metrics import build_offer_dashboard_metrics
from .filters import OfferFilter
from .models import (
    GenerationStatus,
    Offer,
    OfferAlertConfig,
    OfferLine,
    OfferStatus,
    OfferType,
)
from .serializers import (
    ExtendExpirationSerializer,
    OfferAlertConfigSerializer,
    OfferDetailSerializer,
    OfferLineSerializer,
    OfferListSerializer,
    OfferWriteSerializer,
    StatusTransitionSerializer,
)
from .tasks import offer_export_path

# User-driven status transitions (CDC §7.5.1). `expired` is set only by the
# daily cron; reactivation goes through extend-expiration, not /status.
ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    OfferStatus.DRAFT: {OfferStatus.SENT},
    OfferStatus.SENT: {OfferStatus.WON, OfferStatus.LOST},
    OfferStatus.WON: set(),
    OfferStatus.LOST: set(),
    OfferStatus.EXPIRED: set(),
}


class OfferViewSet(viewsets.ModelViewSet):
    queryset = Offer.objects.all().prefetch_related("lines")
    filterset_class = OfferFilter
    search_fields = ("label", "project_name")
    ordering_fields = ("label", "status", "valid_to", "created_at", "updated_at")
    ordering = ("-created_at",)

    def get_serializer_class(self):
        if self.action == "list":
            return OfferListSerializer
        if self.action in {"create", "update", "partial_update"}:
            return OfferWriteSerializer
        return OfferDetailSerializer

    def perform_create(self, serializer):
        simulation: Simulation = serializer.validated_data["simulation"]
        if simulation.status != SimulationStatus.FINALIZED:
            raise ValidationError("Offers can only be created from finalized simulations.")
        serializer.save()

    def perform_destroy(self, instance: Offer) -> None:
        # Deleting an offer is the only destructive action (CDC §7.5.5), but a
        # generation in flight would leave an orphaned Celery task + file.
        if instance.generation_status == GenerationStatus.GENERATING:
            raise ValidationError(
                "Impossible de supprimer une offre en cours de génération. "
                "Réessayez une fois la génération terminée."
            )
        instance.delete()

    # ─── /status (lifecycle transition) ───────────────────────────────
    @action(detail=True, methods=["patch"], url_path="status")
    def set_status(self, request, pk=None):
        offer = self.get_object()
        ser = StatusTransitionSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        new_status = ser.validated_data["status"]

        # Enforce the lifecycle order (e.g. draft→won is rejected; pass via sent).
        if new_status != offer.status and new_status not in ALLOWED_TRANSITIONS.get(
            offer.status, set()
        ):
            raise ValidationError(f"Transition {offer.status} → {new_status} non autorisée.")
        # `won` / `lost` only apply to project offers (CDC §7.5.1).
        if (
            new_status in {OfferStatus.WON, OfferStatus.LOST}
            and offer.offer_type != OfferType.PROJECT
        ):
            raise ValidationError("won/lost transitions only apply to project offers.")

        now = timezone.now()
        offer.status = new_status
        if new_status == OfferStatus.SENT:
            offer.sent_at = now
        elif new_status == OfferStatus.WON:
            offer.won_at = now
        elif new_status == OfferStatus.LOST:
            offer.lost_at = now
            offer.lost_reason = ser.validated_data.get("lost_reason", "")
        offer.save()
        return Response(OfferDetailSerializer(offer).data)

    @staticmethod
    def _create_next_version(src: Offer) -> Offer:
        """Clone a project offer as V(n+1): previous_offer chain + copied lines."""
        copy = Offer.objects.create(
            simulation=src.simulation,
            offer_type=src.offer_type,
            label=src.label,
            client_ids=list(src.client_ids or []),
            project_name=src.project_name,
            project_info=src.project_info,
            currency=src.currency,
            incoterm=src.incoterm,
            language=src.language,
            valid_from=src.valid_from,
            valid_to=src.valid_to,
            validity_duration_days=src.validity_duration_days,
            export_format=src.export_format,
            ai_instructions=src.ai_instructions,
            price_justification=src.price_justification,
            attached_document_ids=list(src.attached_document_ids or []),
            custom_attached_files=src.custom_attached_files,
            status=OfferStatus.DRAFT,
            previous_offer=src,
            version_number=src.version_number + 1,
        )
        for line in src.lines.all():
            OfferLine.objects.create(
                offer=copy,
                product=line.product,
                simulation_line=line.simulation_line,
                final_price=line.final_price,
                discount_pct=line.discount_pct,
                quantity=line.quantity,
                display_order=line.display_order,
            )
        return copy

    # ─── /duplicate · /new-version (new version of a project offer) ──────
    @action(detail=True, methods=["post"], url_path="new-version")
    @transaction.atomic
    def new_version(self, request, pk=None):
        """Create V(n+1) of a project offer (CDC §7.5). Project offers only."""
        src = self.get_object()
        if src.offer_type != OfferType.PROJECT:
            raise ValidationError("Seules les offres projet sont versionnables.")
        copy = self._create_next_version(src)
        return Response(OfferDetailSerializer(copy).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def duplicate(self, request, pk=None):
        """Backward-compatible alias of new-version."""
        return self.new_version(request, pk=pk)

    # ─── /extend-expiration ───────────────────────────────────────────
    @action(detail=True, methods=["post"], url_path="extend-expiration")
    def extend_expiration(self, request, pk=None):
        """Push the validity date out (CDC §7.5). Reactivates an expired offer."""
        offer = self.get_object()
        ser = ExtendExpirationSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        new_date = ser.validated_data["new_date"]
        if new_date <= timezone.now().date() + timedelta(days=7):
            raise ValidationError("La nouvelle date doit être à plus de 7 jours.")
        offer.valid_to = new_date
        if offer.status == OfferStatus.EXPIRED:
            offer.status = OfferStatus.SENT  # reactivate (expired only comes from sent)
        offer.save(update_fields=["valid_to", "status", "updated_at"])
        return Response(OfferDetailSerializer(offer).data)

    # ─── /versions ───────────────────────────────────────────────────
    @action(detail=True, methods=["get"])
    def versions(self, request, pk=None):
        offer = self.get_object()
        chain = []
        cursor = offer
        # walk backwards through `previous_offer`
        while cursor:
            chain.append(cursor)
            cursor = cursor.previous_offer
        chain.reverse()
        # …then forward through `next_versions`
        for c in list(chain):
            for follower in c.next_versions.all():
                if follower not in chain:
                    chain.append(follower)
        return Response(OfferListSerializer(chain, many=True).data)

    # ─── /regenerate (retry Gamma generation — CDC §7.6.3) ───────────
    @action(detail=True, methods=["post"])
    def regenerate(self, request, pk=None):
        """Retry the Gamma generation of a project offer that errored.

        Returns 202 + task_id; poll /api/tasks/{task_id}/.
        """
        from .tasks import regenerate_project_offer_task

        offer = self.get_object()
        if offer.offer_type != OfferType.PROJECT:
            raise ValidationError("La régénération concerne les offres projet.")
        task = regenerate_project_offer_task.delay(str(offer.id))
        return Response({"task_id": task.id, "status": "PENDING"}, status=status.HTTP_202_ACCEPTED)

    # ─── /tariff-columns (catalogue for the generation wizard) ───────
    @action(detail=False, methods=["get"], url_path="tariff-columns")
    def tariff_columns(self, request):
        """Available tariff-Excel columns ([{key, label}]) translated by ?lang."""
        from .services.excel import available_columns

        lang = request.query_params.get("lang", "fr")
        return Response(available_columns(lang))

    # ─── /download (generated Excel/PDF, bundled with attachments) ────
    @action(detail=True, methods=["get"])
    def download(self, request, pk=None):
        """Download the offer, bundling attached library documents (CDC §7.4.4).

        Tariff → the Excel, or a **ZIP** (Excel + annexes) if documents are
        attached. Project → the Gamma PDF, or a single **merged PDF** (quote +
        annexes) if documents are attached. Language is resolved with FR fallback.
        """
        from .services.attachments import (
            bundle_zip,
            fetch_pdf,
            merge_pdfs,
            resolve_attached_documents,
        )

        offer = self.get_object()
        docs = resolve_attached_documents(offer.attached_document_ids, offer.language)

        if offer.offer_type == OfferType.TARIFF:
            path = offer_export_path(offer.id)
            if not path.is_file():
                raise Http404("Document non généré ou expiré.")
            if not docs:
                return FileResponse(
                    path.open("rb"),
                    as_attachment=True,
                    filename=f"tarif_{offer.id}.xlsx",
                    content_type=(
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    ),
                )
            zip_bytes = bundle_zip(f"tarif_{offer.id}.xlsx", path.read_bytes(), docs)
            resp = HttpResponse(zip_bytes, content_type="application/zip")
            resp["Content-Disposition"] = f'attachment; filename="offre_{offer.id}.zip"'
            return resp

        # Project offer → Gamma PDF, optionally merged with the annexes.
        export_url = (offer.project_info or {}).get("gamma_export_url")
        if not export_url:
            raise Http404("PDF du devis non disponible (génération Gamma incomplète).")
        try:
            pdf = fetch_pdf(export_url)
        except Exception as exc:  # noqa: BLE001 — surface a clean 404 to the client
            raise Http404("Impossible de récupérer le PDF du devis Gamma.") from exc
        if docs:
            pdf = merge_pdfs(pdf, docs)
        resp = HttpResponse(pdf, content_type="application/pdf")
        resp["Content-Disposition"] = f'attachment; filename="devis_{offer.id}.pdf"'
        return resp

    # ─── /generate (stub) ────────────────────────────────────────────
    @action(detail=True, methods=["post"])
    def generate(self, request, pk=None):
        """Trigger document generation.

        MVP1: returns 202 with a stub document id.  Real Gamma /
        OpenAI / DeepL orchestration is implemented in
        `apps/offers/services/`.  Wire the call here once those services
        are integration-tested.
        """
        offer = self.get_object()
        # Placeholder: mark the offer as "generated" with a stub URL.
        offer.gamma_document_id = f"stub-{offer.id}"
        offer.generated_file_url = ""  # real flow uploads to storage and stores URL
        offer.save(update_fields=["gamma_document_id", "generated_file_url", "updated_at"])
        return Response(
            {
                "detail": "Generation stub — Gamma integration pending.",
                "gamma_document_id": offer.gamma_document_id,
            },
            status=status.HTTP_202_ACCEPTED,
        )


class OfferLineViewSet(viewsets.ModelViewSet):
    queryset = OfferLine.objects.select_related("product", "offer").all()
    serializer_class = OfferLineSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        offer_id = self.request.query_params.get("offer")
        if offer_id:
            qs = qs.filter(offer_id=offer_id)
        return qs


# ─── Dashboard endpoints (CDC §7.5.3) ────────────────────────────────────


class OfferDashboardView(APIView):
    def get(self, request):
        return Response(build_offer_dashboard_metrics())


class OffersExpiringSoonView(APIView):
    def get(self, request):
        horizon = int(request.query_params.get("days", 7))
        now = timezone.now()
        deadline = now.date() + timedelta(days=horizon)
        offers = Offer.objects.filter(
            Q(valid_to__isnull=False, valid_to__lte=deadline, valid_to__gte=now.date())
        ).order_by("valid_to")
        return Response(OfferListSerializer(offers, many=True).data)


class OfferAlertSettingsView(APIView):
    """Recipients of the J-7 expiration alert — UI-editable (CDC §7.6)."""

    def get(self, request):
        return Response(OfferAlertConfigSerializer(OfferAlertConfig.load()).data)

    def put(self, request):
        cfg = OfferAlertConfig.load()
        ser = OfferAlertConfigSerializer(cfg, data=request.data)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data)
