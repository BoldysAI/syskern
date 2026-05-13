"""Odoo v19 adapter — new JSON-2 API (CDC §5.2)."""
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


class OdooAdapterV19(OdooAdapter):
    """JSON-2 client for Odoo 19.

    MVP1 stub — token-based auth flow is sketched, individual model
    operations are NotImplementedError until the integration phase.
    """

    def __init__(self, *, base_url: str, db_name: str, user: str, password: str, timeout: float = 30.0):
        self.base_url = base_url.rstrip("/")
        self.db_name = db_name
        self.user = user
        self.password = password
        self.timeout = timeout
        self._token: str | None = None
        self._client: httpx.Client | None = None

    def _http(self) -> httpx.Client:
        if self._client is None:
            headers = {"Content-Type": "application/json"}
            if self._token:
                headers["Authorization"] = f"Bearer {self._token}"
            self._client = httpx.Client(base_url=self.base_url, timeout=self.timeout, headers=headers)
        return self._client

    def authenticate(self) -> None:
        # The v19 JSON-2 API exposes /json/2/auth that returns a bearer
        # token.  This is the documented surface; the exact body shape may
        # need adjustment depending on how the Syskern instance is
        # configured (database / db_filter).
        response = httpx.post(
            f"{self.base_url}/json/2/auth",
            json={"db": self.db_name, "username": self.user, "password": self.password},
            timeout=self.timeout,
        )
        if response.status_code != 200:
            raise AuthenticationError(f"Odoo v19 auth HTTP {response.status_code}")
        token = response.json().get("token")
        if not token:
            raise AuthenticationError("Odoo v19 auth returned no token")
        self._token = token
        # Reset cached client so it picks up the new Authorization header.
        self._client = None

    def health_check(self) -> bool:
        try:
            self.authenticate()
            return self._token is not None
        except Exception:
            return False

    # ─── Stubs ────────────────────────────────────────────────────────
    def list_products(
        self, modified_since: Optional[datetime] = None, limit: int = 100, offset: int = 0
    ) -> list[OdooProduct]:
        raise NotImplementedError

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
