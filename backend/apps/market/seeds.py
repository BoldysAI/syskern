"""Idempotent seed of market reference data (CDC §3.3).

Helpers take the model class as argument so the same code runs against both
historical models (from a data migration's ``apps.get_model``) and the real
models (from tests).  Re-running is a no-op thanks to ``get_or_create``.
"""

from __future__ import annotations

from typing import Any

# 11 ICC 2020 incoterms (CDC §3.3).
INCOTERMS: list[dict[str, Any]] = [
    {"code": "EXW", "label": {"fr": "À l'usine", "en": "Ex Works", "es": "En fábrica"}},
    {
        "code": "FCA",
        "label": {"fr": "Franco transporteur", "en": "Free Carrier", "es": "Franco transportista"},
    },
    {
        "code": "FAS",
        "label": {
            "fr": "Franco le long du navire",
            "en": "Free Alongside Ship",
            "es": "Franco al costado del buque",
        },
    },
    {
        "code": "FOB",
        "label": {"fr": "Franco à bord", "en": "Free On Board", "es": "Franco a bordo"},
    },
    {
        "code": "CFR",
        "label": {"fr": "Coût et fret", "en": "Cost and Freight", "es": "Coste y flete"},
    },
    {
        "code": "CIF",
        "label": {
            "fr": "Coût, assurance et fret",
            "en": "Cost, Insurance and Freight",
            "es": "Coste, seguro y flete",
        },
    },
    {
        "code": "CPT",
        "label": {
            "fr": "Port payé jusqu'à",
            "en": "Carriage Paid To",
            "es": "Transporte pagado hasta",
        },
    },
    {
        "code": "CIP",
        "label": {
            "fr": "Port payé, assurance comprise, jusqu'à",
            "en": "Carriage and Insurance Paid To",
            "es": "Transporte y seguro pagados hasta",
        },
    },
    {
        "code": "DAP",
        "label": {
            "fr": "Rendu au lieu de destination",
            "en": "Delivered At Place",
            "es": "Entregado en lugar",
        },
    },
    {
        "code": "DPU",
        "label": {
            "fr": "Rendu au lieu de destination déchargé",
            "en": "Delivered at Place Unloaded",
            "es": "Entregado en lugar descargado",
        },
    },
    {
        "code": "DDP",
        "label": {
            "fr": "Rendu droits acquittés",
            "en": "Delivered Duty Paid",
            "es": "Entregado con derechos pagados",
        },
    },
]

# 7 transport modes (CDC §3.3).  ``default_pallet_capacity`` = None → manual.
TRANSPORT_MODES: list[dict[str, Any]] = [
    {
        "code": "40HQ",
        "label": {
            "fr": "Conteneur 40' High Cube",
            "en": "40' High Cube container",
            "es": "Contenedor 40' High Cube",
        },
        "category": "maritime",
        "default_pallet_capacity": 40,
    },
    {
        "code": "40FT",
        "label": {"fr": "Conteneur 40'", "en": "40' container", "es": "Contenedor 40'"},
        "category": "maritime",
        "default_pallet_capacity": 40,
    },
    {
        "code": "20FT",
        "label": {"fr": "Conteneur 20'", "en": "20' container", "es": "Contenedor 20'"},
        "category": "maritime",
        "default_pallet_capacity": 22,
    },
    {
        "code": "TRUCK_FULL",
        "label": {"fr": "Camion complet", "en": "Full truckload", "es": "Camión completo"},
        "category": "road",
        "default_pallet_capacity": 33,
    },
    {
        "code": "TRUCK_LCL",
        "label": {"fr": "Camion groupé", "en": "Less than truckload", "es": "Camión grupado"},
        "category": "road",
        "default_pallet_capacity": None,
    },
    {
        "code": "AIR_FREIGHT",
        "label": {"fr": "Fret aérien", "en": "Air freight", "es": "Flete aéreo"},
        "category": "air",
        "default_pallet_capacity": None,
    },
    {
        "code": "EXPRESS",
        "label": {"fr": "Express (UPS/DHL)", "en": "Express (UPS/DHL)", "es": "Exprés (UPS/DHL)"},
        "category": "air",
        "default_pallet_capacity": None,
    },
]


def seed_incoterms(incoterm_model: Any) -> None:
    for order, entry in enumerate(INCOTERMS):
        incoterm_model.objects.get_or_create(
            code=entry["code"],
            defaults={"label": entry["label"], "display_order": order, "is_active": True},
        )


def seed_transport_modes(transport_mode_model: Any) -> None:
    for entry in TRANSPORT_MODES:
        transport_mode_model.objects.get_or_create(
            code=entry["code"],
            defaults={
                "label": entry["label"],
                "category": entry["category"],
                "default_pallet_capacity": entry["default_pallet_capacity"],
                "is_active": True,
            },
        )


# Kept for migration 0005 backwards compatibility only — presets are user-created (no seed).
TRANSPORT_PRESETS: list[dict[str, Any]] = []


def seed_transport_presets(transport_preset_model: Any) -> None:
    """No-op: transport presets are created by users in settings or from simulations."""


def seed_market_reference_data(incoterm_model: Any, transport_mode_model: Any) -> None:
    seed_incoterms(incoterm_model)
    seed_transport_modes(transport_mode_model)
