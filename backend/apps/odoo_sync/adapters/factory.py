"""Adapter factory — selects v16 or v19 based on settings or explicit version.

`get_odoo_adapter()` returns the default adapter from settings.
`get_odoo_adapter_for(version)` returns a specific version's adapter, reading
its dedicated env vars (ODOO_V16_* or ODOO_V19_*).

Both are used by the sync runner to support dual-instance sync without doublons.
"""
from __future__ import annotations

from django.conf import settings

from .base import OdooAdapter
from .v16 import OdooAdapterV16
from .v19 import OdooAdapterV19


def _build_shared_kwargs(cfg: dict) -> dict:
    return {
        "base_url": cfg.get("BASE_URL", ""),
        "db_name": cfg.get("DB_NAME", ""),
        "user": cfg.get("API_USER", ""),
        "password": cfg.get("API_PASSWORD", ""),
        "timeout": float(cfg.get("TIMEOUT_SECONDS", 60)),
        "verify_tls": str(cfg.get("VERIFY_TLS", "true")).lower() not in ("false", "0", "no"),
    }


def get_odoo_adapter() -> OdooAdapter:
    """Return the default adapter based on ODOO_API_VERSION setting."""
    cfg = settings.ODOO
    version = (cfg.get("API_VERSION") or "v19").lower()
    return _instantiate(version, _build_shared_kwargs(cfg))


def get_odoo_adapter_for(version: str) -> OdooAdapter:
    """Return an adapter for a specific Odoo version, reading its own env vars.

    Reads from the ODOO dict in settings:
      v16 → ODOO["V16_BASE_URL"], ODOO["V16_DB_NAME"], etc.
      v19 → ODOO["V19_BASE_URL"], ODOO["V19_DB_NAME"], etc.
    Falls back to the shared credentials if version-specific ones are absent.
    """
    version = version.lower()
    cfg = settings.ODOO
    prefix = f"V{version.upper().lstrip('V')}_"
    kwargs = {
        "base_url": cfg.get(f"{prefix}BASE_URL") or cfg.get("BASE_URL", ""),
        "db_name": cfg.get(f"{prefix}DB_NAME") or cfg.get("DB_NAME", ""),
        "user": cfg.get(f"{prefix}API_USER") or cfg.get("API_USER", ""),
        "password": cfg.get(f"{prefix}API_PASSWORD") or cfg.get("API_PASSWORD", ""),
        "timeout": float(cfg.get("TIMEOUT_SECONDS", 60)),
        "verify_tls": str(
            cfg.get(f"{prefix}VERIFY_TLS", cfg.get("VERIFY_TLS", "true"))
        ).lower() not in ("false", "0", "no"),
    }
    return _instantiate(version, kwargs)


def _instantiate(version: str, kwargs: dict) -> OdooAdapter:
    if version == "v16":
        return OdooAdapterV16(**kwargs)
    if version == "v19":
        return OdooAdapterV19(**kwargs)
    raise ValueError(f"Unsupported ODOO_API_VERSION: {version!r}")
