"""Shared JSON-RPC helpers used by both v16 and v19 adapters.

Both Odoo 16 and Odoo 19 (staging) expose the classic JSON-RPC endpoint at
``/jsonrpc`` and the ``execute_kw`` pattern.  This mixin encapsulates the
low-level plumbing so neither adapter has to repeat it.

Retry policy (CDC §5.5)
-----------------------
- HTTP 5xx / network timeouts / connection errors: 3 attempts with
  exponential backoff (2s, 4s, 8s).
- 4xx and Odoo-level errors: no retry (caller-correctable).
- Session expiry / access denied during execute_kw: re-authenticate
  once and retry the same call.
"""

from __future__ import annotations

import logging
import time
from typing import Any

import httpx

from .base import AuthenticationError

logger = logging.getLogger(__name__)


# Network-level exceptions worth retrying.
_RETRYABLE_NET_EXC = (
    httpx.TimeoutException,
    httpx.NetworkError,
    httpx.RemoteProtocolError,
)

# Heuristic markers that signal an expired session on Odoo's side, where
# re-authenticating and replaying the call is the correct recovery.
_AUTH_EXPIRED_MARKERS = (
    "session expired",
    "accessdenied",
    "access denied",
    "invalid uid",
    "you are not allowed",
)


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

    def _post_jsonrpc(self, payload: dict, *, max_attempts: int = 3) -> dict:
        """POST /jsonrpc with retry on transient errors (CDC §5.5).

        Retries: 3 attempts max with exponential backoff (2s, 4s, 8s) on
        connection errors, timeouts, and HTTP 5xx responses.
        Does NOT retry on 4xx or Odoo-level (in-body) errors.
        """
        last_exc: Exception | None = None
        for attempt in range(1, max_attempts + 1):
            try:
                resp = self._http().post("/jsonrpc", json=payload)
            except _RETRYABLE_NET_EXC as exc:
                last_exc = exc
            else:
                if resp.status_code >= 500:
                    last_exc = httpx.HTTPStatusError(
                        f"Odoo returned {resp.status_code}",
                        request=resp.request,
                        response=resp,
                    )
                elif resp.status_code >= 400:
                    resp.raise_for_status()  # bubbles up immediately, no retry
                else:
                    return resp.json()

            if attempt < max_attempts:
                sleep_s = 2**attempt
                logger.warning(
                    "Odoo RPC transient failure (attempt %d/%d), retrying in %ds: %s",
                    attempt,
                    max_attempts,
                    sleep_s,
                    last_exc,
                )
                time.sleep(sleep_s)

        assert last_exc is not None
        raise last_exc

    def _call(self, service: str, method: str, args: list) -> Any:
        """Low-level JSON-RPC call. Raises on HTTP error or Odoo-level error."""
        body = self._post_jsonrpc(
            {
                "jsonrpc": "2.0",
                "method": "call",
                "params": {"service": service, "method": method, "args": args},
            }
        )
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
        """execute_kw convenience wrapper.

        Auto-authenticates, and transparently re-authenticates + retries
        once if Odoo signals an expired session.
        """
        uid = self._ensure_auth()
        try:
            return self._call(
                "object",
                "execute_kw",
                [self.db_name, uid, self.password, model, method, args, kwargs or {}],
            )
        except RuntimeError as exc:
            msg = str(exc).lower()
            if not any(marker in msg for marker in _AUTH_EXPIRED_MARKERS):
                raise
            logger.warning(
                "Odoo session likely expired on %s.%s — re-authenticating and retrying once",
                model,
                method,
            )
            self._uid = None
            uid = self._ensure_auth()
            return self._call(
                "object",
                "execute_kw",
                [self.db_name, uid, self.password, model, method, args, kwargs or {}],
            )
