"""Seed the current market parameters from the client's data (CDC §5.7).

Market parameters are normally entered by hand (§5.7), but for bootstrapping we
seed the current values extracted from the client Excel files so the pricing
wizard's "Pré-remplir depuis les paramètres actifs" returns real numbers.

Values below are the client's current references (UKN `PO & SC` header +
`Monthly_Copper_Evolution` `SH 3mm RMB`): copper 102000 RMB/t (Shanghai 3mm),
EUR/RMB 8.19, EUR/USD 1.17. Override via flags and re-run — the command is
idempotent per (type, market/pair, valid_from) and deactivates older active rows.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.market.models import CopperMarket, MarketParameter, MarketParameterType


class Command(BaseCommand):
    help = "Seed current copper + FX market parameters from the client data (CDC §5.7)."

    def add_arguments(self, parser: Any) -> None:
        parser.add_argument(
            "--copper-rmb", default="102000", help="Current copper price (RMB/tonne)."
        )
        parser.add_argument(
            "--copper-market", default=CopperMarket.SHE, choices=CopperMarket.values
        )
        parser.add_argument("--fx-eur-rmb", default="8.19", help="1 EUR = X RMB.")
        parser.add_argument("--fx-eur-usd", default="1.17", help="1 EUR = X USD.")
        parser.add_argument("--source", default="client Excel", help="Data source label.")

    @transaction.atomic
    def handle(self, *args: Any, **opts: Any) -> None:
        today = timezone.now().date()
        source = opts["source"]

        # Copper spot (Shanghai 3mm, RMB/tonne).
        self._upsert_copper(opts["copper_market"], Decimal(opts["copper_rmb"]), today, source)
        # FX rates, expressed from EUR (engine convention).
        self._upsert_fx("EUR", "RMB", Decimal(opts["fx_eur_rmb"]), today, source)
        self._upsert_fx("EUR", "USD", Decimal(opts["fx_eur_usd"]), today, source)

        self.stdout.write(
            self.style.SUCCESS("Market parameters seeded (copper + EUR/RMB + EUR/USD).")
        )

    def _upsert_copper(self, market: str, price: Decimal, day, source: str) -> None:
        MarketParameter.objects.filter(
            parameter_type=MarketParameterType.COPPER_PRICE, copper_market=market, is_active=True
        ).update(is_active=False)
        MarketParameter.objects.update_or_create(
            parameter_type=MarketParameterType.COPPER_PRICE,
            copper_market=market,
            valid_from=day,
            defaults={
                "copper_price": price,
                "copper_currency": "RMB",
                "copper_unit": "tonne",
                "source": source,
                "is_active": True,
            },
        )

    def _upsert_fx(self, frm: str, to: str, rate: Decimal, day, source: str) -> None:
        MarketParameter.objects.filter(
            parameter_type=MarketParameterType.FX_RATE,
            fx_from_currency=frm,
            fx_to_currency=to,
            is_active=True,
        ).update(is_active=False)
        MarketParameter.objects.update_or_create(
            parameter_type=MarketParameterType.FX_RATE,
            fx_from_currency=frm,
            fx_to_currency=to,
            valid_from=day,
            defaults={"fx_rate": rate, "source": source, "is_active": True},
        )
