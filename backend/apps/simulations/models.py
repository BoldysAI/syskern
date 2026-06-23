"""Simulations — the heart of the pricing engine (CDC §3.2 + §6).

A simulation freezes a full snapshot of the parameters used (market params,
calculation chain, supplier data, product data) so that historical results
stay reproducible even when source data evolves.
"""

from __future__ import annotations

from decimal import Decimal

from django.contrib.postgres.fields import ArrayField
from django.contrib.postgres.indexes import GinIndex
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from apps.core.models import BaseModel
from apps.products.models import Incoterm

# ─── Choices ──────────────────────────────────────────────────────────────────


class SimulationType(models.TextChoices):
    TARIFF = "tariff", "Tariff (multi-clients)"
    PROJECT = "project", "Project (single client)"


class SimulationStatus(models.TextChoices):
    DRAFT = "draft", "Draft"
    FINALIZED = "finalized", "Finalized"
    ARCHIVED = "archived", "Archived"


class RecalculationTrigger(models.TextChoices):
    """Why a recalculation row was created (CDC §6.9.12)."""

    MANUAL_CURRENT_PARAMS = "manual_current_params", "Manual — current params"
    MANUAL_REFRESH_ODOO = "manual_refresh_odoo", "Manual — refresh Odoo"
    MANUAL_FULL_REFRESH = "manual_full_refresh", "Manual — full refresh"
    LINE_RECALCULATE = "line_recalculate", "Single-line recalc"
    INITIAL = "initial", "Initial calculation"
    FINALIZE = "finalize", "Finalize snapshot"


# ─── Simulation ───────────────────────────────────────────────────────────────


class Simulation(BaseModel):
    label = models.CharField(max_length=255)
    simulation_type = models.CharField(max_length=16, choices=SimulationType.choices)

    # Context — N clients for a tariff, exactly 1 for a project.
    client_ids = ArrayField(models.UUIDField(), default=list, blank=True)
    project_name = models.CharField(max_length=255, blank=True, default="")

    # Frozen market parameters used by the last recalculation (CDC §3.2).
    # {
    #   "copper_base_price_rmb": 70000,
    #   "copper_current_price_rmb": 97000,
    #   "fx_eur_rmb": 7.95,
    #   "fx_eur_usd": 1.15,
    #   "valid_from": "2026-04-28",
    #   "valid_to": "2026-07-28"
    # }
    market_params = models.JSONField(default=dict, blank=True)

    # Ordered modules of the PA / PV chains (drag-and-drop UI).
    # See CDC §6.2 for the canonical structure.
    calculation_chain = models.JSONField(default=dict, blank=True)

    # Global stock/purchase mix, expressed as a percentage 0..100.
    stock_purchase_mix_pct = models.IntegerField(
        default=0,
        validators=[MinValueValidator(0), MaxValueValidator(100)],
    )

    # Margin defaults (overridable per simulation line).
    symea_margin_rate = models.DecimalField(
        max_digits=5,
        decimal_places=4,
        default="0.0600",
        validators=[MinValueValidator(Decimal("0")), MaxValueValidator(Decimal("0.9999"))],
    )
    syskern_margin_rate = models.DecimalField(
        max_digits=5,
        decimal_places=4,
        default="0.2000",
        validators=[MinValueValidator(Decimal("0")), MaxValueValidator(Decimal("0.9999"))],
    )

    # Sale-side commercial hypothesis (CDC §6.8.3 — defaults reused by offers).
    sale_incoterm = models.CharField(
        max_length=4,
        choices=Incoterm.choices,
        default=Incoterm.EXW,
    )
    sale_incoterm_location = models.CharField(max_length=128, blank=True, default="")

    status = models.CharField(
        max_length=16, choices=SimulationStatus.choices, default=SimulationStatus.DRAFT
    )

    # Timestamp + dirty flag for the recalc UX (CDC §6.9.4).
    last_calculated_at = models.DateTimeField(null=True, blank=True)
    odoo_snapshot_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Odoo data freshness at the last global recalculation.",
    )
    is_dirty = models.BooleanField(
        default=True,
        help_text="True when parameters have been modified since last recalc.",
    )

    class Meta:
        db_table = "simulations"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["simulation_type"], name="idx_simulations_type"),
            models.Index(fields=["status"], name="idx_simulations_status"),
            models.Index(fields=["-created_at"], name="idx_simulations_created"),
            models.Index(
                fields=["simulation_type", "status"],
                name="idx_simulations_type_status",
            ),
            GinIndex(fields=["client_ids"], name="idx_simulations_client_ids_gin"),
        ]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(
                    status__in=[
                        SimulationStatus.DRAFT,
                        SimulationStatus.FINALIZED,
                        SimulationStatus.ARCHIVED,
                    ]
                ),
                name="simulations_status_valid",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.label} [{self.status}]"


# ─── SimulationLine ───────────────────────────────────────────────────────────


class SimulationLine(BaseModel):
    """One row per SKU within a simulation, with a frozen snapshot."""

    simulation = models.ForeignKey(Simulation, on_delete=models.CASCADE, related_name="lines")
    product = models.ForeignKey(
        "products.Product", on_delete=models.PROTECT, related_name="simulation_lines"
    )

    # Frozen copies (CDC §6.9.10 — modifying the product after calc must not
    # alter the line).
    product_snapshot = models.JSONField(default=dict)
    supplier_snapshot = models.JSONField(default=dict)

    # Per-line overrides (NULL = inherits the simulation-wide value).
    margin_override = models.DecimalField(
        max_digits=5,
        decimal_places=4,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal("0")), MaxValueValidator(Decimal("0.9999"))],
    )
    stock_purchase_mix_pct_override = models.IntegerField(
        null=True,
        blank=True,
        validators=[MinValueValidator(0), MaxValueValidator(100)],
    )

    # Calculated outputs (all 4-decimal Decimals; conversions to display
    # rounding happen at the serializer level).
    po_net_origin_currency = models.DecimalField(
        max_digits=12, decimal_places=4, null=True, blank=True
    )
    po_net_eur = models.DecimalField(max_digits=12, decimal_places=4, null=True, blank=True)
    pa_net_eur = models.DecimalField(max_digits=12, decimal_places=4, null=True, blank=True)
    pamp_predictive_eur = models.DecimalField(
        max_digits=12, decimal_places=4, null=True, blank=True
    )
    pr_eur = models.DecimalField(max_digits=12, decimal_places=4, null=True, blank=True)
    pv_eur = models.DecimalField(max_digits=12, decimal_places=4, null=True, blank=True)

    # Frozen effective values used at calculation time (CDC §6.9.10).
    effective_margin_rate = models.DecimalField(
        max_digits=6,
        decimal_places=4,
        null=True,
        blank=True,
    )
    effective_mix_pct = models.IntegerField(null=True, blank=True)

    # Audit trail of the calculation, mirrors `calculation_breakdown` in the CDC.
    calculation_breakdown = models.JSONField(default=dict, blank=True)

    # Per-line status, see CDC §6.6.
    status = models.CharField(
        max_length=16,
        default="pending",
        help_text="'pending' | 'ok' | 'warning' | 'error' | 'dirty'",
    )
    last_calculated_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "simulation_lines"
        indexes = [
            models.Index(fields=["simulation"], name="idx_sim_lines_sim"),
            models.Index(fields=["product"], name="idx_sim_lines_product"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["simulation", "product"],
                name="unique_product_per_simulation",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.simulation_id} · {self.product_id}"


# ─── Recalculation traces ─────────────────────────────────────────────────────


class SimulationRecalculation(BaseModel):
    """Frozen snapshot of a recalculation event (CDC §6.9.12).

    Every full recalc inserts one row.  Single-line recalcs do NOT create a
    trace — they're considered operational events and only get an app log.
    """

    simulation = models.ForeignKey(
        Simulation, on_delete=models.CASCADE, related_name="recalculations"
    )
    calculated_at = models.DateTimeField()

    market_params = models.JSONField()
    odoo_snapshot_at = models.DateTimeField(null=True, blank=True)
    calculation_chain = models.JSONField()

    stock_purchase_mix_pct = models.IntegerField()
    syskern_margin_rate = models.DecimalField(max_digits=5, decimal_places=4)
    symea_margin_rate = models.DecimalField(max_digits=5, decimal_places=4)
    sale_incoterm = models.CharField(max_length=4, choices=Incoterm.choices, default=Incoterm.EXW)
    sale_incoterm_location = models.CharField(max_length=128, blank=True, default="")

    # Aggregated results — surfaces in the recalc history panel without
    # needing to refetch the lines.
    aggregates = models.JSONField()

    # Frozen per-SKU results at recalc time (CDC §6.9.12 — "Voir détail" +
    # "Comparer avec actuel"). One entry per line: sku/designation + pa/pr/pv,
    # effective margin/mix and status. Kept here so a historical recalc can be
    # inspected line-by-line and compared against the live state.
    line_snapshots = models.JSONField(default=list, blank=True)

    trigger_type = models.CharField(max_length=32, choices=RecalculationTrigger.choices)
    note = models.TextField(blank=True, default="")

    class Meta:
        db_table = "simulation_recalculations"
        ordering = ["-calculated_at"]
        indexes = [
            models.Index(
                fields=["simulation", "-calculated_at"],
                name="idx_recalc_simulation_date",
            ),
        ]

    def __str__(self) -> str:
        return f"Recalc {self.simulation_id} @ {self.calculated_at:%Y-%m-%d %H:%M}"


# ─── Saved comparison ─────────────────────────────────────────────────────────


class SavedComparison(BaseModel):
    """Persisted compare configuration (CDC §6.9.8 extension).

    Stores the ordered simulation and recalculation column IDs so a user can
    reopen the same comparison later without re-selecting items.
    """

    label = models.CharField(max_length=255)
    simulation_ids = ArrayField(models.UUIDField(), default=list)
    recalculation_ids = ArrayField(models.UUIDField(), default=list)
    note = models.TextField(blank=True, default="")

    class Meta:
        db_table = "saved_comparisons"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        n = len(self.simulation_ids) + len(self.recalculation_ids)
        return f"{self.label} ({n} col.)"

    @property
    def column_count(self) -> int:
        return len(self.simulation_ids) + len(self.recalculation_ids)
