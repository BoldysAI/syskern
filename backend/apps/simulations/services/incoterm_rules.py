"""Incoterm coherence rules for simulation chains (CDC §6.8.3, §12.2).

Pure helpers — no Django ORM, no pricing math. The engine still applies
transport/customs modules from the user-configured chain; these functions
suggest skeleton chains and emit non-blocking French warnings.
"""
from __future__ import annotations

from apps.products.models import Incoterm

# ─── Sale-side groups (CDC §6.8.3) ───────────────────────────────────────────

_NO_SALE_TRANSPORT = frozenset({Incoterm.EXW})
_NO_MAIN_SALE_TRANSPORT = frozenset({Incoterm.FCA, Incoterm.FOB, Incoterm.FAS})
_MAIN_SALE_TRANSPORT = frozenset({Incoterm.CFR, Incoterm.CIF, Incoterm.CPT, Incoterm.CIP})
_DELIVERY_SALE_TRANSPORT = frozenset({Incoterm.DAP, Incoterm.DPU})
_DELIVERY_WITH_CUSTOMS = frozenset({Incoterm.DDP})

# ─── Purchase-side groups (CDC §12.2 impact table) ───────────────────────────

_BUYER_PAYS_ALL = frozenset({Incoterm.EXW})
_TO_PORT = frozenset({Incoterm.FAS, Incoterm.FOB})
_MAIN_INCLUDED = frozenset({Incoterm.CFR, Incoterm.CIF, Incoterm.CPT, Incoterm.CIP})
_DELIVERED = frozenset({Incoterm.DAP, Incoterm.DPU, Incoterm.DDP})


def _transport_leg(order: int, category: str, currency: str) -> dict:
    return {
        "order": order,
        "transport_mode_code": "",
        "category": category,
        "global_cost": "0",
        "currency": currency,
        "pallet_count": 0,
        "from_location": "",
        "to_location": "",
        "override_coefficient": None,
    }


def _count_transports(chain: dict | None) -> int:
    if not chain:
        return 0
    return len(chain.get("transports") or [])


def _customs_active(chain: dict | None) -> bool:
    if not chain:
        return False
    customs = chain.get("customs")
    return customs is not None and customs != {}


def suggest_purchase_chain(
    purchase_incoterm: str,
    *,
    symea_rate: str = "0.0600",
    symea_position: str = "after_transports",
) -> dict:
    """Structural PA chain skeleton — no invented monetary values (CDC §6.4)."""
    inc = purchase_incoterm or Incoterm.FOB
    transports: list[dict] = []
    customs: dict | None = None

    if inc in _BUYER_PAYS_ALL or inc in _TO_PORT:
        transports = [
            _transport_leg(1, "maritime", "USD"),
            _transport_leg(2, "road", "EUR"),
        ]
        customs = {"rate_pct": ""}
    elif inc in _MAIN_INCLUDED:
        transports = [_transport_leg(1, "road", "EUR")]
    elif inc == Incoterm.DDP:
        customs = {"rate_pct": ""}

    return {
        "copper_variation": {},
        "currency_conversion": {"to_currency": "EUR"},
        "transports": transports,
        "customs": customs,
        "symea_margin": {"rate": symea_rate, "position": symea_position},
    }


def suggest_sale_chain(
    sale_incoterm: str,
    *,
    syskern_rate: str = "0.2000",
) -> dict:
    """Structural PV chain skeleton for the given sale incoterm."""
    inc = sale_incoterm or Incoterm.EXW
    transports: list[dict] = []
    customs: dict | None = None

    if inc in _MAIN_SALE_TRANSPORT:
        transports = [_transport_leg(1, "maritime", "USD")]
    elif inc in _DELIVERY_SALE_TRANSPORT:
        transports = [_transport_leg(1, "road", "EUR")]
    elif inc in _DELIVERY_WITH_CUSTOMS:
        transports = [_transport_leg(1, "road", "EUR")]
        customs = {"rate_pct": ""}

    return {
        "transports": transports,
        "customs": customs,
        "syskern_margin": {"rate": syskern_rate},
    }


def check_sale_chain_coherence(sale_incoterm: str, sale_chain: dict | None) -> list[str]:
    """Non-blocking warnings when the PV chain mismatches the sale incoterm (§6.8.3)."""
    inc = sale_incoterm or Incoterm.EXW
    n_transport = _count_transports(sale_chain)
    has_customs = _customs_active(sale_chain)
    warnings: list[str] = []

    if inc in _NO_SALE_TRANSPORT:
        if n_transport > 0:
            warnings.append(
                "Incoterm de vente EXW : aucun transport côté vente attendu — "
                "vérifiez la chaîne PV."
            )
        if has_customs:
            warnings.append(
                "Incoterm de vente EXW : douane côté vente inattendue — "
                "vérifiez la chaîne PV."
            )
    elif inc in _NO_MAIN_SALE_TRANSPORT:
        if n_transport > 0:
            warnings.append(
                f"Incoterm de vente {inc} : pas de transport principal côté vente "
                f"attendu — vérifiez la chaîne PV."
            )
    elif inc in _MAIN_SALE_TRANSPORT:
        if n_transport == 0:
            warnings.append(
                f"Incoterm de vente {inc} : un transport principal côté vente est "
                f"attendu — chaîne PV incomplète."
            )
    elif inc in _DELIVERY_SALE_TRANSPORT:
        if n_transport == 0:
            warnings.append(
                f"Incoterm de vente {inc} : transport jusqu'à destination attendu — "
                f"chaîne PV incomplète."
            )
    elif inc in _DELIVERY_WITH_CUSTOMS:
        if n_transport == 0:
            warnings.append(
                "Incoterm de vente DDP : transport jusqu'à destination attendu — "
                "chaîne PV incomplète."
            )
        if not has_customs:
            warnings.append(
                "Incoterm de vente DDP : douane import incluse — activez le module "
                "douane côté vente."
            )
    return warnings


def check_purchase_chain_coherence(
    purchase_incoterm: str,
    purchase_chain: dict | None,
) -> list[str]:
    """Non-blocking warnings when the PA chain mismatches the supplier incoterm (§12.2)."""
    if not purchase_incoterm:
        return []
    inc = purchase_incoterm
    n_transport = _count_transports(purchase_chain)
    has_customs = _customs_active(purchase_chain)
    warnings: list[str] = []

    if inc in _BUYER_PAYS_ALL:
        if n_transport == 0:
            warnings.append(
                f"Incoterm achat {inc} : des transports post-PO sont attendus dans "
                f"la chaîne PA — complétez les legs logistiques."
            )
    elif inc in _TO_PORT:
        if n_transport == 0:
            warnings.append(
                f"Incoterm achat {inc} : transport vers le port d'embarquement attendu — "
                f"chaîne PA incomplète."
            )
    elif inc in _MAIN_INCLUDED:
        if n_transport > 1:
            warnings.append(
                f"Incoterm achat {inc} : le fret principal est souvent déjà inclus "
                f"dans le PO — vérifiez que la chaîne PA ne double pas le transport."
            )
    elif inc in _DELIVERED:
        if n_transport > 0:
            warnings.append(
                f"Incoterm achat {inc} : peu ou pas de transport PA supplémentaire "
                f"attendu — vérifiez la cohérence avec le PO fournisseur."
            )
        if inc == Incoterm.DDP and not has_customs:
            warnings.append(
                "Incoterm achat DDP : douane import souvent incluse dans le PO — "
                "vérifiez le module douane PA."
            )
    return warnings


def build_incoterm_context(
    *,
    sale_incoterm: str,
    sale_incoterm_location: str,
    purchase_incoterm: str,
    purchase_incoterm_location: str,
) -> dict:
    return {
        "sale_incoterm": sale_incoterm or Incoterm.EXW,
        "sale_incoterm_location": sale_incoterm_location or "",
        "purchase_incoterm": purchase_incoterm or "",
        "purchase_incoterm_location": purchase_incoterm_location or "",
    }
