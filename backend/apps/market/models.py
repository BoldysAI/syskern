"""Reference data driving the pricing engine.

Covers:
- transport modes (CDC §3.2 → `transport_modes`)
- market parameters: copper spot prices, FX rates (`market_parameters`)

The list of Incoterms lives in `apps.products.models.Incoterm` as a
TextChoices enum — there is no need for a separate database table since the
codes are fixed by ICC 2020.
"""
from __future__ import annotations

from django.db import models

from apps.core.models import BaseModel, Currency


class TransportCategory(models.TextChoices):
    MARITIME = "maritime", "Maritime"
    ROAD = "road", "Road"
    AIR = "air", "Air"
    RAIL = "rail", "Rail"


class TransportMode(BaseModel):
    code = models.CharField(max_length=32, unique=True)
    label = models.JSONField(help_text="Multilingual label")
    category = models.CharField(max_length=16, choices=TransportCategory.choices)
    default_pallet_capacity = models.IntegerField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "transport_modes"
        ordering = ["category", "code"]

    def __str__(self) -> str:
        return self.code


class MarketParameterType(models.TextChoices):
    COPPER_PRICE = "copper_price", "Copper spot price"
    FX_RATE = "fx_rate", "FX rate"


class CopperMarket(models.TextChoices):
    LME = "LME", "London Metal Exchange"
    SHE = "SHE", "Shanghai Futures Exchange"


class MarketParameter(BaseModel):
    """Historised copper prices and FX rates entered manually by Olivier.

    Snapshotted into `simulations.market_params` at simulation time so that
    historical calculations remain reproducible.
    """

    parameter_type = models.CharField(max_length=16, choices=MarketParameterType.choices)

    # ─── Copper price columns ────────────────────────────────────────────
    copper_market = models.CharField(
        max_length=4, choices=CopperMarket.choices, blank=True, default=""
    )
    copper_price = models.DecimalField(
        max_digits=12, decimal_places=2, null=True, blank=True
    )
    copper_currency = models.CharField(
        max_length=3, choices=Currency.choices, blank=True, default=""
    )
    copper_unit = models.CharField(max_length=16, blank=True, default="tonne")

    # ─── FX rate columns ─────────────────────────────────────────────────
    fx_from_currency = models.CharField(
        max_length=3, choices=Currency.choices, blank=True, default=""
    )
    fx_to_currency = models.CharField(
        max_length=3, choices=Currency.choices, blank=True, default=""
    )
    fx_rate = models.DecimalField(max_digits=12, decimal_places=6, null=True, blank=True)

    valid_from = models.DateField()
    valid_to = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True, default="")
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "market_parameters"
        ordering = ["-valid_from"]
        indexes = [
            models.Index(
                fields=["parameter_type", "-valid_from"],
                name="idx_market_params_type",
            ),
        ]

    def __str__(self) -> str:
        if self.parameter_type == MarketParameterType.COPPER_PRICE:
            return f"Cu {self.copper_market} {self.copper_price} {self.copper_currency}/{self.copper_unit} @ {self.valid_from}"
        return f"FX {self.fx_from_currency}→{self.fx_to_currency} {self.fx_rate} @ {self.valid_from}"
