"""Activate the ProductSupplier that carries a real ``po_base_price`` (CDC §3.2).

The pricing engine prices from the **active** supplier's ``po_base_price``
(`apps.simulations.services.runner`). After the initial migration ~97% of
products had the distributor (Symea) active with price 0, while the real
factory price sat on an *inactive* source — so only 3% were priceable.

This command repairs the active flag per product:
  • active source already priced → left untouched;
  • exactly one priced source     → activate it (unambiguous);
  • several priced sources         → activate the cheapest (EUR-normalised)
                                     and flag the product for manual review.

Idempotent; respects the ``one_active_supplier_per_product`` partial index.
``--dry-run`` previews without writing. The multi-priced heuristic (cheapest)
is a provisional default — the definitive choice is a procurement decision
(CDC/Annexe); the flagged list is the review queue.
"""

from __future__ import annotations

from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.market.models import MarketParameter, MarketParameterType
from apps.products.models import Product, ProductSupplier


def eur_fx_rates() -> dict[str, Decimal]:
    """Latest active ``EUR→CCY`` rates from MarketParameter (CCY per 1 EUR)."""
    rates: dict[str, Decimal] = {}
    for mp in (
        MarketParameter.objects.filter(parameter_type=MarketParameterType.FX_RATE, is_active=True)
        .exclude(fx_rate=None)
        .order_by("-valid_from")
    ):
        if (mp.fx_from_currency or "").upper() == "EUR" and mp.fx_to_currency:
            rates.setdefault(mp.fx_to_currency.upper(), Decimal(str(mp.fx_rate)))
    return rates


def to_eur(price: Decimal, currency: str, fx: dict[str, Decimal]) -> Decimal | None:
    """Convert ``price`` in ``currency`` to EUR, or ``None`` if unconvertible."""
    ccy = (currency or "EUR").upper()
    if ccy == "EUR":
        return price
    rate = fx.get(ccy)
    if not rate:
        return None
    return price / rate


def choose_priced_supplier(
    suppliers: list[ProductSupplier], fx: dict[str, Decimal]
) -> ProductSupplier | None:
    """Pick the source to activate: the (EUR-cheapest) one carrying a price.

    Returns ``None`` when no supplier has a usable ``po_base_price``.
    Unconvertible currencies sort last; ties broken by supplier name for
    determinism.
    """
    priced = [s for s in suppliers if s.po_base_price and s.po_base_price > 0]
    if not priced:
        return None

    def sort_key(s: ProductSupplier):
        eur = to_eur(s.po_base_price, s.po_currency, fx)
        return (eur is None, eur if eur is not None else Decimal(0), s.supplier_name or "")

    return sorted(priced, key=sort_key)[0]


def activate_priced_suppliers(*, dry_run: bool = False) -> dict:
    """Activate a priced source per product. Returns counts + the multi-priced
    review list. Reused by the management command and the migration pipeline
    (``data_migration.steps.step_supplier_activation``)."""
    fx = eur_fx_rates()
    already_ok = fixed_single = fixed_multi = no_price = 0
    multi_rows: list[str] = []

    qs = Product.objects.filter(is_active=True).prefetch_related("suppliers")
    for p in qs.iterator(chunk_size=200):
        sups = list(p.suppliers.all())
        active = next((s for s in sups if s.is_active), None)
        if active and active.po_base_price and active.po_base_price > 0:
            already_ok += 1
            continue

        priced = [s for s in sups if s.po_base_price and s.po_base_price > 0]
        if not priced:
            no_price += 1
            continue

        chosen = choose_priced_supplier(sups, fx)
        if chosen is None:  # pragma: no cover - guarded by `priced`
            no_price += 1
            continue

        if len(priced) == 1:
            fixed_single += 1
        else:
            fixed_multi += 1
            opts_str = ", ".join(
                f"{s.supplier_name}={s.po_base_price}{s.po_currency}" for s in priced
            )
            multi_rows.append(f"  {p.sku_code}: [{opts_str}] → {chosen.supplier_name}")

        if not dry_run:
            with transaction.atomic():
                p.suppliers.exclude(pk=chosen.pk).update(is_active=False)
                ProductSupplier.objects.filter(pk=chosen.pk).update(is_active=True)

    return {
        "already_ok": already_ok,
        "fixed_single": fixed_single,
        "fixed_multi": fixed_multi,
        "no_price": no_price,
        "multi_rows": multi_rows,
        "fx": fx,
    }


class Command(BaseCommand):
    help = "Activate the priced supplier per product so the pricing engine can run."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Preview without writing.")
        parser.add_argument(
            "--show-multi",
            action="store_true",
            help="List the multi-priced products chosen by the cheapest heuristic.",
        )

    def handle(self, *args, **opts):
        dry = opts["dry_run"]
        r = activate_priced_suppliers(dry_run=dry)
        verb = "WOULD activate" if dry else "activated"
        self.stdout.write(
            f"FX EUR→ rates: {r['fx'] or '(none — cross-currency ties fall back to name)'}\n"
        )
        self.stdout.write(f"Active source already priced (kept) : {r['already_ok']}")
        self.stdout.write(f"Single priced source ({verb})        : {r['fixed_single']}")
        self.stdout.write(
            f"Multi priced → cheapest ({verb})     : {r['fixed_multi']}  (review these)"
        )
        self.stdout.write(f"No price anywhere (data gap)         : {r['no_price']}")
        if opts["show_multi"] and r["multi_rows"]:
            self.stdout.write("\nMulti-priced products (arbitrate against CDC/Annexe):")
            for row in r["multi_rows"]:
                self.stdout.write(row)
        if dry:
            self.stdout.write(self.style.WARNING("\nDRY RUN — no changes written."))
