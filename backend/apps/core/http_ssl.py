"""TLS verification helper for outbound ``httpx`` clients."""

from __future__ import annotations


def httpx_verify(enabled: bool = True) -> bool | str:
    """Return the CA bundle for httpx when verification is on.

    When ``enabled`` is false, returns ``False`` (dev-only escape hatch for
    macOS Python installs that lack a trusted issuer store — same pattern as
    ``ODOO_*_VERIFY_TLS``).
    """
    if not enabled:
        return False
    try:
        import certifi

        return certifi.where()
    except ImportError:
        return True
