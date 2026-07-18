"""Offers — tariffs (multi-clients) or projects (single client).

Cf. CDC §3.2 → `offers`, `offer_lines` and §7.
"""

from __future__ import annotations

from django.contrib.postgres.fields import ArrayField
from django.db import models

from apps.core.models import BaseModel, Currency, Language
from apps.products.models import Incoterm


class OfferType(models.TextChoices):
    TARIFF = "tariff", "Tariff (multi-clients)"
    PROJECT = "project", "Project (single client)"


class OfferStatus(models.TextChoices):
    DRAFT = "draft", "Draft"
    SENT = "sent", "Sent"
    WON = "won", "Won (project only)"
    LOST = "lost", "Lost (project only)"
    EXPIRED = "expired", "Expired"


class ExportFormat(models.TextChoices):
    EXCEL = "excel", "Excel"
    CATALOG = "catalog", "Gamma catalog (tariff)"
    DEVIS_GAMMA = "devis_gamma", "Gamma quote (project)"


class GenerationStatus(models.TextChoices):
    """Document generation lifecycle, distinct from the commercial `status`."""

    PENDING = "pending", "Pending"
    GENERATING = "generating", "Generating"
    READY = "ready", "Ready"
    ERROR = "error", "Error (retry possible)"


class GammaTemplate(models.TextChoices):
    """Project-offer layout chosen at generation (FEEDBACK 1, CDC §7.7.2).

    Each value maps to a client-owned Gamma template id configured in
    ``settings.GAMMA["TEMPLATES"]``; an empty value uses the default
    (``TEMPLATE_ID_DEVIS_PROJET``). The templates themselves are designed by
    the client — the platform only references their ids.
    """

    DISTRIBUTEUR = "distributeur", "Distributeur"
    FACTORING = "factoring", "Factoring"
    EXPORT = "export", "Export"


class Offer(BaseModel):
    simulation = models.ForeignKey(
        "simulations.Simulation",
        on_delete=models.PROTECT,
        related_name="offers",
        help_text="Must be a finalized simulation (CDC §7.9).",
    )
    offer_type = models.CharField(max_length=16, choices=OfferType.choices)
    label = models.CharField(max_length=255)

    # Targets — N clients for a tariff, exactly 1 for a project.
    client_ids = ArrayField(models.UUIDField(), default=list, blank=True)
    project_name = models.CharField(max_length=255, blank=True, default="")
    project_info = models.JSONField(default=dict, blank=True)

    # Commercial parameters
    currency = models.CharField(max_length=3, choices=Currency.choices)
    incoterm = models.CharField(max_length=4, choices=Incoterm.choices)
    language = models.CharField(max_length=2, choices=Language.choices, default=Language.FR)

    # Validity
    valid_from = models.DateField(null=True, blank=True)
    valid_to = models.DateField(null=True, blank=True)
    validity_duration_days = models.IntegerField(null=True, blank=True)

    # Generation parameters
    export_format = models.CharField(max_length=16, choices=ExportFormat.choices)
    # Project-offer Gamma layout (FEEDBACK 1). Empty = default project template.
    gamma_template = models.CharField(
        max_length=32, choices=GammaTemplate.choices, blank=True, default=""
    )
    ai_instructions = models.TextField(blank=True, default="")
    price_justification = models.TextField(blank=True, default="")

    # Attached documents
    attached_document_ids = ArrayField(models.UUIDField(), default=list, blank=True)
    custom_attached_files = models.JSONField(
        default=list,
        blank=True,
        help_text='[{"filename": "...", "storage_path": "..."}]',
    )

    # Generation results
    generated_file_url = models.TextField(blank=True, default="")
    gamma_document_id = models.CharField(max_length=128, blank=True, default="")
    generation_status = models.CharField(
        max_length=16,
        choices=GenerationStatus.choices,
        default=GenerationStatus.PENDING,
        help_text="Document generation state (separate from the commercial status).",
    )
    generation_error = models.TextField(blank=True, default="")
    # AI-generated arguments cached for re-use on retry (CDC §7.3.4).
    ai_arguments = models.JSONField(default=dict, blank=True)

    # Lifecycle tracking
    status = models.CharField(max_length=16, choices=OfferStatus.choices, default=OfferStatus.DRAFT)
    sent_at = models.DateTimeField(null=True, blank=True)
    won_at = models.DateTimeField(null=True, blank=True)
    lost_at = models.DateTimeField(null=True, blank=True)
    lost_reason = models.TextField(blank=True, default="")

    # Versioning — project offers can be re-emitted (V1, V2, V3…).
    previous_offer = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="next_versions",
    )
    version_number = models.IntegerField(default=1)

    class Meta:
        db_table = "offers"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["offer_type"], name="idx_offers_type"),
            models.Index(fields=["status"], name="idx_offers_status"),
            models.Index(fields=["valid_to"], name="idx_offers_valid_to"),
            models.Index(fields=["previous_offer"], name="idx_offers_previous"),
        ]

    def __str__(self) -> str:
        return f"{self.label} [{self.status}]"


class OfferLine(BaseModel):
    offer = models.ForeignKey(Offer, on_delete=models.CASCADE, related_name="lines")
    product = models.ForeignKey(
        "products.Product", on_delete=models.PROTECT, related_name="offer_lines"
    )
    simulation_line = models.ForeignKey(
        "simulations.SimulationLine",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="offer_lines",
    )

    # Negotiated final price — may diverge from the simulation PV after
    # commercial adjustment.
    final_price = models.DecimalField(max_digits=12, decimal_places=4)
    discount_pct = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    quantity = models.DecimalField(
        max_digits=12,
        decimal_places=3,
        null=True,
        blank=True,
        help_text="Filled for project offers; null for tariffs.",
    )

    display_order = models.IntegerField(default=0)

    class Meta:
        db_table = "offer_lines"
        ordering = ["offer_id", "display_order"]
        indexes = [
            models.Index(fields=["offer"], name="idx_offer_lines_offer"),
        ]

    def __str__(self) -> str:
        return f"{self.offer_id} · {self.product_id}"


class OfferAlertConfig(BaseModel):
    """Singleton config for the offer-expiration J-7 alert (CDC §7.6).

    Recipients are edited from the UI (Paramètres → Alertes offres), not env.
    """

    recipients = ArrayField(models.EmailField(), default=list, blank=True)

    class Meta:
        db_table = "offer_alert_config"

    @classmethod
    def load(cls) -> OfferAlertConfig:
        """Return the single config row, creating it on first access."""
        return cls.objects.first() or cls.objects.create()

    def __str__(self) -> str:
        return f"OfferAlertConfig({len(self.recipients)} recipients)"
