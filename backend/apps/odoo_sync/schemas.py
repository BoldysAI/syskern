"""Version-agnostic schemas exchanged with the rest of the backend.

The adapters (`OdooAdapterV16`, `OdooAdapterV19`) read whatever Odoo
returns and normalise to these dataclasses.  Nothing in the rest of the
codebase should ever touch raw Odoo payloads.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Optional


@dataclass
class OdooSupplierLink:
    name: str
    factory_code: str = ""
    price: Optional[Decimal] = None
    currency: str = "RMB"
    incoterm: str = ""


@dataclass
class OdooProduct:
    """Subset of `product.template` + `product.product`."""

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
    weight_kg: Optional[Decimal] = None
    standard_price_eur: Optional[Decimal] = None
    suppliers: list[OdooSupplierLink] = field(default_factory=list)
    is_active: bool = True
    last_modified: Optional[datetime] = None


@dataclass
class OdooStock:
    quantity: Decimal
    available_quantity: Decimal
    standard_price_eur: Optional[Decimal] = None


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
    last_modified: Optional[datetime] = None


@dataclass
class OdooPurchaseLine:
    quantity: Decimal
    price_unit: Decimal
    currency: str
    expected_date: Optional[datetime] = None
