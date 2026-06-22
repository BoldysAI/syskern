from __future__ import annotations

from datetime import timedelta

from django.db import transaction
from django.db.models import Count, F, Q, Sum
from django.http import FileResponse, Http404
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.simulations.models import Simulation, SimulationStatus

from .models import Offer, OfferLine, OfferStatus, OfferType
from .serializers import (
    OfferDetailSerializer,
    OfferLineSerializer,
    OfferListSerializer,
    OfferWriteSerializer,
    StatusTransitionSerializer,
)
from .tasks import offer_export_path


class OfferViewSet(viewsets.ModelViewSet):
    queryset = Offer.objects.all().prefetch_related("lines")
    filterset_fields = ("offer_type", "status", "currency", "language", "export_format")
    search_fields = ("label", "project_name")
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

    # ─── /status (lifecycle transition) ───────────────────────────────
    @action(detail=True, methods=["patch"], url_path="status")
    def set_status(self, request, pk=None):
        offer = self.get_object()
        ser = StatusTransitionSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        new_status = ser.validated_data["status"]

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

    # ─── /duplicate (new version of a project offer) ─────────────────
    @action(detail=True, methods=["post"])
    @transaction.atomic
    def duplicate(self, request, pk=None):
        src = self.get_object()
        if src.offer_type != OfferType.PROJECT:
            raise ValidationError("Only project offers can be versioned.")
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
        return Response(OfferDetailSerializer(copy).data, status=status.HTTP_201_CREATED)

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

    # ─── /tariff-columns (catalogue for the generation wizard) ───────
    @action(detail=False, methods=["get"], url_path="tariff-columns")
    def tariff_columns(self, request):
        """Available tariff-Excel columns ([{key, label}]) translated by ?lang."""
        from .services.excel import available_columns

        lang = request.query_params.get("lang", "fr")
        return Response(available_columns(lang))

    # ─── /download (generated Excel/PDF) ─────────────────────────────
    @action(detail=True, methods=["get"])
    def download(self, request, pk=None):
        """Stream the generated tariff Excel (CDC §7.8 — GET /offers/{id}/download)."""
        offer = self.get_object()
        path = offer_export_path(offer.id)
        if not path.is_file():
            raise Http404("Document non généré ou expiré.")
        return FileResponse(
            path.open("rb"),
            as_attachment=True,
            filename=f"tarif_{offer.id}.xlsx",
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )

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
        now = timezone.now()
        counts = Offer.objects.values("status").annotate(n=Count("id")).order_by()
        status_counts = {row["status"]: row["n"] for row in counts}

        project_qs = Offer.objects.filter(offer_type=OfferType.PROJECT)
        won = project_qs.filter(status=OfferStatus.WON).count()
        lost = project_qs.filter(status=OfferStatus.LOST).count()
        conversion = (won / (won + lost) * 100) if (won + lost) else None

        # Sum of "won" offer line totals (sum(final_price * quantity)).
        won_total = (
            OfferLine.objects.filter(offer__status=OfferStatus.WON)
            .aggregate(total=Sum(F("final_price") * F("quantity")))
            .get("total")
        )

        tariff_active = Offer.objects.filter(
            offer_type=OfferType.TARIFF,
            status__in=[OfferStatus.SENT, OfferStatus.DRAFT],
            valid_to__gte=now.date(),
        ).count()

        return Response(
            {
                "status_counts": status_counts,
                "project_conversion_pct": conversion,
                "won_total": str(won_total) if won_total is not None else None,
                "tariff_active": tariff_active,
            }
        )


class OffersExpiringSoonView(APIView):
    def get(self, request):
        horizon = int(request.query_params.get("days", 7))
        now = timezone.now()
        deadline = now.date() + timedelta(days=horizon)
        offers = Offer.objects.filter(
            Q(valid_to__isnull=False, valid_to__lte=deadline, valid_to__gte=now.date())
        ).order_by("valid_to")
        return Response(OfferListSerializer(offers, many=True).data)
