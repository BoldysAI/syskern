"""Version-agnostic schemas exchanged with the rest of the backend.

The adapters (`OdooAdapterV16`, `OdooAdapterV19`) read whatever Odoo
returns and normalise to these dataclasses.  Nothing in the rest of the
codebase should ever touch raw Odoo payloads.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal


@dataclass
class OdooSupplierLink:
    name: str
    factory_code: str = ""
    price: Decimal | None = None
    currency: str = "RMB"
    incoterm: str = ""


@dataclass
class OdooProduct:
    """Subset of `product.template` + `product.product`.

    Field-mapping reference (CDC §5.3):
      • sku_code              ↔ Odoo `default_code` (fallback to `name`)
      • name (commercial)     ↔ Odoo `name`
      • gtin                  ↔ Odoo `barcode` (v16) / `gtin_code` (v19)
      • hs_code               ↔ Odoo `hs_code` (native)
      • weight_kg             ↔ Odoo `weight`
      • standard_price_eur    ↔ Odoo `standard_price` (PAMP)
      • universe/family/...   ↔ Odoo `categ_id.parent_path` (parsed)
    """

    odoo_id: int
    sku_code: str
    name: str
    universe: str = ""
    family: str = ""
    range: str = ""
    sub_range: str = ""
    description_marketing_fr: str = ""
    description_technical_fr: str = ""
    gtin: str = ""
    hs_code: str = ""
    # Enrichment fields — Odoo carries these, previously dropped on the floor.
    #   brand      ↔ Odoo `brand_id` (v19 only)
    #   dop_number ↔ Odoo `x_studio_num_dop_china` / `_trkiye`
    #   uom_name   ↔ Odoo `uom_id` label (mapped to BaseUnit by the runner)
    brand: str = ""
    dop_number: str = ""
    uom_name: str = ""
    #   item_code  ↔ Odoo `item_code` (champ natif de l'instance client, char)
    #   Référence article ~8 caractères, distincte du SKU (`default_code`) —
    #   demandée par le client en recette (FEEDBACK 2).
    item_code: str = ""
    # Packaging levels from Odoo `product.packaging` (CDC §3.2 — "issu d'Odoo").
    # Named PRIMARY / SECONDARY / TERTIARY / LOGISTIC on the client instance.
    primary_packaging_qty: int | None = None
    secondary_packaging_qty: int | None = None
    tertiary_packaging_qty: int | None = None
    pallet_qty: int | None = None
    weight_kg: Decimal | None = None
    standard_price_eur: Decimal | None = None
    suppliers: list[OdooSupplierLink] = field(default_factory=list)
    is_active: bool = True
    last_modified: datetime | None = None


@dataclass
class OdooStock:
    quantity: Decimal
    available_quantity: Decimal
    standard_price_eur: Decimal | None = None


@dataclass
class OdooClient:
    odoo_id: int
    name: str
    email: str = ""
    phone: str = ""
    address_street: str = ""
    address_city: str = ""
    address_zip: str = ""
    address_country: str = ""
    preferred_language: str = "fr"
    is_customer: bool = True
    last_modified: datetime | None = None


@dataclass
class OdooPurchaseLine:
    quantity: Decimal
    price_unit: Decimal
    currency: str
    expected_date: datetime | None = None
