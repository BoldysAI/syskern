"""User-facing French messages for pricing-engine failures (CDC §6.6)."""

from __future__ import annotations

import re

# Keys in ``market_params`` → short label for error copy.
_FX_PARAM_LABELS: dict[str, str] = {
    "fx_eur_usd": "EUR → USD",
    "fx_eur_rmb": "EUR → RMB",
    "fx_eur_jpy": "EUR → JPY",
    "fx_eur_gbp": "EUR → GBP",
}

_MISSING_FX_RE = re.compile(
    r"Missing FX rate `(fx_eur_\w+)` in market parameters\.",
)


def missing_fx_rate_message(param_key: str) -> str:
    """Explain a missing EUR-pivot FX rate in plain French."""
    label = _FX_PARAM_LABELS.get(param_key)
    if label:
        return (
            f"Taux de change {label} manquant : renseignez-le dans les "
            f"paramètres marché de la simulation, puis relancez le recalcul."
        )
    return (
        "Taux de change manquant dans les paramètres marché de la simulation. "
        "Complétez les cours de change EUR, puis relancez le recalcul."
    )


def _looks_user_facing(msg: str) -> bool:
    """Heuristic: message already written for end users (French copy)."""
    if any(c in msg for c in "àâçéèêëîïôùûüœ"):
        return True
    prefixes = (
        "Produit ",
        "Taux ",
        "Paramètres ",
        "Mix ",
        "Incoterm ",
        "Le ",
        "La ",
        "Des ",
        "Impossible",
        "Une ",
        "Aucun",
    )
    return msg.startswith(prefixes)


def humanize_engine_error(exc: BaseException) -> str:
    """Map engine exceptions to French, non-technical copy for the UI."""
    msg = str(exc).strip()
    if not msg:
        return "Le calcul a échoué pour une raison inconnue."

    fx = _MISSING_FX_RE.fullmatch(msg)
    if fx:
        return missing_fx_rate_message(fx.group(1))

    if msg.startswith("mix_pct must be in"):
        return "Mix stock/achat invalide : la valeur doit être comprise entre 0 et 100 %."

    if _looks_user_facing(msg):
        return msg

    return (
        "Le calcul n'a pas pu aboutir. Vérifiez les paramètres de la simulation "
        "(marché, incoterms, fournisseurs), puis relancez le recalcul."
    )
