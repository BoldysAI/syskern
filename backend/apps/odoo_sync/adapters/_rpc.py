"""Shared JSON-RPC helpers used by both v16 and v19 adapters.

Both Odoo 16 and Odoo 19 (staging) expose the classic JSON-RPC endpoint at
``/jsonrpc`` and the ``execute_kw`` pattern.  This mixin encapsulates the
low-level plumbing so neither adapter has to repeat it.
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

from .base import AuthenticationError

logger = logging.getLogger(__name__)


class JsonRpcMixin:
    """Provides ``_call`` / ``_execute_kw`` / ``authenticate`` for JSON-RPC Odoo instances."""

    base_url: str
    db_name: str
    user: str
    password: str
    timeout: float

    _uid: int | None = None
    _client: httpx.Client | None = None

    # Subclasses may override to disable TLS verification on dev instances.
    _verify_tls: bool = True

    def _http(self) -> httpx.Client:
        if self._client is None:
            self._client = httpx.Client(
                base_url=self.base_url,
                timeout=self.timeout,
                verify=self._verify_tls,
            )
        return self._client

    def _call(self, service: str, method: str, args: list) -> Any:
        """Low-level JSON-RPC call.  Raises on HTTP error or Odoo-level error."""
        resp = self._http().post(
            "/jsonrpc",
            json={
                "jsonrpc": "2.0",
                "method": "call",
                "params": {"service": service, "method": method, "args": args},
            },
        )
        resp.raise_for_status()
        body = resp.json()
        if body.get("error"):
            err = body["error"]
            msg = err.get("data", {}).get("message") or str(err)
            raise RuntimeError(f"Odoo error: {msg}")
        return body["result"]

    def authenticate(self) -> None:
        uid = self._call("common", "login", [self.db_name, self.user, self.password])
        if not uid:
            raise AuthenticationError(
                f"Odoo authenticate() returned falsy uid for user={self.user!r}"
            )
        self._uid = uid
        logger.debug("Odoo auth OK uid=%s base_url=%s", uid, self.base_url)

    def health_check(self) -> bool:
        try:
            self.authenticate()
            return self._uid is not None
        except Exception:
            return False

    def _ensure_auth(self) -> int:
        if not self._uid:
            self.authenticate()
        assert self._uid is not None
        return self._uid

    def _kw(
        self,
        model: str,
        method: str,
        args: list,
        kwargs: dict | None = None,
    ) -> Any:
        """execute_kw convenience wrapper (auto-authenticates)."""
        uid = self._ensure_auth()
        return self._call(
            "object",
            "execute_kw",
            [self.db_name, uid, self.password, model, method, args, kwargs or {}],
        )
