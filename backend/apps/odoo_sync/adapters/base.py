"""Abstract Odoo adapter interface.

The factory in `apps.odoo_sync.adapters.factory.get_odoo_adapter()` returns
an instance of `OdooAdapterV16` or `OdooAdapterV19` based on the
`ODOO_API_VERSION` setting.  No code outside this package should know
which Odoo version is currently in use (CDC §5.1).
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime

from apps.odoo_sync.schemas import (
    OdooClient,
    OdooProduct,
    OdooPurchaseLine,
    OdooStock,
)


class AuthenticationError(RuntimeError):
    pass


class OdooAdapter(ABC):
    """Operations the rest of the backend needs from Odoo."""

    # ─── Auth & health ────────────────────────────────────────────────
    @abstractmethod
    def authenticate(self) -> None: ...

    @abstractmethod
    def health_check(self) -> bool: ...

    # ─── Products ─────────────────────────────────────────────────────
    @abstractmethod
    def list_products(
        self,
        modified_since: datetime | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[OdooProduct]: ...

    @abstractmethod
    def get_product(self, odoo_id: int) -> OdooProduct: ...

    @abstractmethod
    def create_product(self, product: OdooProduct) -> int: ...

    @abstractmethod
    def update_product(self, odoo_id: int, fields: dict) -> None: ...

    # ─── Stock ────────────────────────────────────────────────────────
    @abstractmethod
    def get_stock_quantities(self, odoo_product_ids: list[int]) -> dict[int, OdooStock]: ...

    # ─── Pending purchases / sales (for predictive PAMP) ──────────────
    @abstractmethod
    def get_pending_purchases(
        self, odoo_product_ids: list[int]
    ) -> dict[int, list[OdooPurchaseLine]]: ...

    @abstractmethod
    def get_pending_sales(
        self, odoo_product_ids: list[int]
    ) -> dict[int, list[OdooPurchaseLine]]: ...

    # ─── Clients ──────────────────────────────────────────────────────
    @abstractmethod
    def list_clients(
        self,
        modified_since: datetime | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[OdooClient]: ...

    @abstractmethod
    def get_client(self, odoo_id: int) -> OdooClient: ...
