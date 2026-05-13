"""Odoo v16 adapter — XML-RPC / JSON-RPC via `execute_kw` (CDC §5.2)."""
from __future__ import annotations

from datetime import datetime
from typing import Optional

import httpx

from apps.odoo_sync.schemas import (
    OdooClient,
    OdooProduct,
    OdooPurchaseLine,
    OdooStock,
)

from .base import AuthenticationError, OdooAdapter


class OdooAdapterV16(OdooAdapter):
    """JSON-RPC client for Odoo 16.

    MVP1 implementation is a stub — the surface is defined and the
    constructor wires httpx, but each method raises NotImplementedError
    until the real integration is implemented against the staging
    instance (CDC §5.10, phase d'investigation).
    """

    def __init__(self, *, base_url: str, db_name: str, user: str, password: str, timeout: float = 30.0):
        self.base_url = base_url.rstrip("/")
        self.db_name = db_name
        self.user = user
        self.password = password
        self.timeout = timeout
        self._uid: int | None = None
        self._client: httpx.Client | None = None

    # ─── Auth ─────────────────────────────────────────────────────────
    def _http(self) -> httpx.Client:
        if self._client is None:
            self._client = httpx.Client(base_url=self.base_url, timeout=self.timeout)
        return self._client

    def authenticate(self) -> None:
        client = self._http()
        response = client.post(
            "/jsonrpc",
            json={
                "jsonrpc": "2.0",
                "method": "call",
                "params": {
                    "service": "common",
                    "method": "login",
                    "args": [self.db_name, self.user, self.password],
                },
            },
        )
        if response.status_code != 200:
            raise AuthenticationError(f"Odoo v16 auth HTTP {response.status_code}")
        payload = response.json()
        uid = payload.get("result")
        if not uid:
            raise AuthenticationError("Odoo v16 auth returned no uid")
        self._uid = uid

    def health_check(self) -> bool:
        try:
            self.authenticate()
            return self._uid is not None
        except Exception:
            return False

    # ─── Stubs — wire against staging during the investigation phase ──
    def list_products(
        self, modified_since: Optional[datetime] = None, limit: int = 100, offset: int = 0
    ) -> list[OdooProduct]:
        raise NotImplementedError("v16 list_products — to implement post-investigation.")

    def get_product(self, odoo_id: int) -> OdooProduct:
        raise NotImplementedError

    def create_product(self, product: OdooProduct) -> int:
        raise NotImplementedError

    def update_product(self, odoo_id: int, fields: dict) -> None:
        raise NotImplementedError

    def get_stock_quantities(self, odoo_product_ids: list[int]) -> dict[int, OdooStock]:
        raise NotImplementedError

    def get_pending_purchases(self, odoo_product_ids: list[int]) -> dict[int, list[OdooPurchaseLine]]:
        raise NotImplementedError

    def get_pending_sales(self, odoo_product_ids: list[int]) -> dict[int, list[OdooPurchaseLine]]:
        raise NotImplementedError

    def list_clients(
        self, modified_since: Optional[datetime] = None, limit: int = 100, offset: int = 0
    ) -> list[OdooClient]:
        raise NotImplementedError

    def get_client(self, odoo_id: int) -> OdooClient:
        raise NotImplementedError
