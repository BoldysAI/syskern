"""Adapter factory — selects v16 or v19 based on settings.

`get_odoo_adapter()` is the only function the rest of the codebase calls.
Tests can monkey-patch this to inject a fake implementation.
"""
from __future__ import annotations

from django.conf import settings

from .base import OdooAdapter
from .v16 import OdooAdapterV16
from .v19 import OdooAdapterV19


def get_odoo_adapter() -> OdooAdapter:
    cfg = settings.ODOO
    version = (cfg.get("API_VERSION") or "v19").lower()
    kwargs = {
        "base_url": cfg.get("BASE_URL", ""),
        "db_name": cfg.get("DB_NAME", ""),
        "user": cfg.get("API_USER", ""),
        "password": cfg.get("API_PASSWORD", ""),
        "timeout": float(cfg.get("TIMEOUT_SECONDS", 60)),
        "verify_tls": str(cfg.get("VERIFY_TLS", "true")).lower() not in ("false", "0", "no"),
    }
    if version == "v16":
        return OdooAdapterV16(**kwargs)
    if version == "v19":
        return OdooAdapterV19(**kwargs)
    raise ValueError(f"Unsupported ODOO_API_VERSION: {version!r}")
