"""Investigation command — READ-ONLY exploration of both Odoo instances.

Driven by `ODOO_V16_*` / `ODOO_V19_*` environment variables.  Never writes
to either instance.  Used to produce the mapping document required by
CDC §5.10 before the adapter implementations are written.

Usage:
    docker compose run --rm backend python manage.py odoo_explore --action ping
    docker compose run --rm backend python manage.py odoo_explore --action fields --model product.template
    docker compose run --rm backend python manage.py odoo_explore --action sample --model product.template --limit 5
    docker compose run --rm backend python manage.py odoo_explore --action categories
    docker compose run --rm backend python manage.py odoo_explore --action full-report
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any

import httpx
from django.core.management.base import BaseCommand


# ─── Read-only JSON-RPC client ────────────────────────────────────────────


@dataclass
class OdooConn:
    label: str
    base_url: str
    db: str
    user: str
    api_key: str
    uid: int | None = None
    timeout: float = 60.0
    verify_tls: bool = True

    @classmethod
    def from_env(cls, label: str) -> "OdooConn":
        prefix = f"ODOO_{label.upper()}"
        verify = os.environ.get(f"{prefix}_VERIFY_TLS", "true").lower() != "false"
        return cls(
            label=label,
            base_url=os.environ[f"{prefix}_BASE_URL"].rstrip("/"),
            db=os.environ[f"{prefix}_DB_NAME"],
            user=os.environ[f"{prefix}_API_USER"],
            api_key=os.environ[f"{prefix}_API_PASSWORD"],
            verify_tls=verify,
        )

    def _call(self, service: str, method: str, args: list) -> Any:
        with httpx.Client(timeout=self.timeout, verify=self.verify_tls) as client:
            r = client.post(
                f"{self.base_url}/jsonrpc",
                json={
                    "jsonrpc": "2.0",
                    "method": "call",
                    "params": {"service": service, "method": method, "args": args},
                },
            )
            r.raise_for_status()
            body = r.json()
            if body.get("error"):
                err = body["error"]
                raise RuntimeError(f"Odoo {self.label} error: {err.get('data', {}).get('message') or err}")
            return body.get("result")

    # ─── Auth ────────────────────────────────────────────────────────
    def authenticate(self) -> int:
        uid = self._call("common", "authenticate", [self.db, self.user, self.api_key, {}])
        if not uid:
            raise RuntimeError(f"Authentication failed for {self.label}.")
        self.uid = uid
        return uid

    def version(self) -> dict:
        return self._call("common", "version", [])

    # ─── execute_kw — READ-ONLY methods only ─────────────────────────
    def execute_kw(self, model: str, method: str, args: list, kwargs: dict | None = None) -> Any:
        # Hard guard: this command must never write.  Allow only the
        # documented read methods.
        ALLOWED = {
            "fields_get", "search", "search_read", "search_count", "read",
            "name_get", "name_search", "default_get",
        }
        if method not in ALLOWED:
            raise PermissionError(
                f"Write method `{method}` is not allowed in the investigation command."
            )
        if self.uid is None:
            self.authenticate()
        return self._call(
            "object", "execute_kw",
            [self.db, self.uid, self.api_key, model, method, args, kwargs or {}],
        )


# ─── Helpers ──────────────────────────────────────────────────────────────


def _is_custom_field(name: str) -> bool:
    return name.startswith("x_")


# ─── Actions ──────────────────────────────────────────────────────────────


def action_ping(conns: list[OdooConn], **kwargs) -> dict:
    """Reachability + auth check on each instance."""
    out = {}
    for c in conns:
        try:
            v = c.version()
            uid = c.authenticate()
            out[c.label] = {
                "ok": True,
                "version": v.get("server_version"),
                "serie": v.get("server_serie"),
                "uid": uid,
                "base_url": c.base_url,
                "db": c.db,
            }
        except Exception as e:
            out[c.label] = {"ok": False, "error": str(e), "base_url": c.base_url, "db": c.db}
    return out


def action_fields(conns: list[OdooConn], *, model: str, **kwargs) -> dict:
    """List all fields of a model, splitting standard vs custom."""
    out = {}
    for c in conns:
        c.authenticate()
        try:
            fields = c.execute_kw(
                model, "fields_get", [],
                {"attributes": ["string", "type", "required", "readonly", "relation", "selection", "store"]},
            )
            standard = {k: v for k, v in fields.items() if not _is_custom_field(k)}
            custom = {k: v for k, v in fields.items() if _is_custom_field(k)}
            out[c.label] = {
                "model": model,
                "field_count": len(fields),
                "custom_field_count": len(custom),
                "custom_fields": custom,
                "standard_fields_sample": dict(list(standard.items())[:5]),
            }
        except Exception as e:
            out[c.label] = {"error": str(e), "model": model}
    return out


def action_sample(conns: list[OdooConn], *, model: str, limit: int = 5, fields: list | None = None, **kwargs) -> dict:
    """Read a handful of records to inspect actual data shape."""
    out = {}
    for c in conns:
        c.authenticate()
        try:
            records = c.execute_kw(model, "search_read", [[]], {"limit": limit, "fields": fields or []})
            out[c.label] = {
                "model": model,
                "count_returned": len(records),
                "records": records,
            }
        except Exception as e:
            out[c.label] = {"error": str(e), "model": model}
    return out


def action_count(conns: list[OdooConn], *, model: str, **kwargs) -> dict:
    """Count records in a model — first volumetry signal."""
    out = {}
    for c in conns:
        c.authenticate()
        try:
            n = c.execute_kw(model, "search_count", [[]])
            out[c.label] = {"model": model, "count": n}
        except Exception as e:
            out[c.label] = {"error": str(e), "model": model}
    return out


def action_categories(conns: list[OdooConn], **kwargs) -> dict:
    """Inspect product.category hierarchy (CDC §4.2 — 4 levels expected)."""
    out = {}
    for c in conns:
        c.authenticate()
        try:
            cats = c.execute_kw(
                "product.category", "search_read", [[]],
                {"fields": ["id", "name", "parent_id", "complete_name", "parent_path"], "limit": 200},
            )
            out[c.label] = {
                "count": len(cats),
                "sample": cats[:25],
            }
        except Exception as e:
            out[c.label] = {"error": str(e)}
    return out


def action_full_report(conns: list[OdooConn], **kwargs) -> dict:
    """End-to-end inventory used as the mapping document baseline."""
    report = {"ping": action_ping(conns)}

    # Skip the rest of the report for any instance that failed auth.
    live = [c for c in conns if report["ping"].get(c.label, {}).get("ok")]
    if not live:
        return report

    report["counts"] = {}
    for model in [
        "product.template", "product.product", "product.supplierinfo",
        "product.category", "stock.quant", "res.partner",
        "purchase.order", "purchase.order.line",
        "sale.order", "sale.order.line",
    ]:
        report["counts"][model] = action_count(live, model=model)

    report["fields"] = {}
    for model in ["product.template", "product.product", "product.supplierinfo", "res.partner"]:
        report["fields"][model] = action_fields(live, model=model)

    report["samples"] = {}
    report["samples"]["product.template"] = action_sample(
        live, model="product.template", limit=3,
        fields=[
            "id", "name", "default_code", "categ_id", "barcode", "weight",
            "standard_price", "list_price", "description", "description_sale",
            "active", "type", "uom_id", "seller_ids",
        ],
    )
    report["samples"]["product.product"] = action_sample(
        live, model="product.product", limit=3,
        fields=["id", "name", "default_code", "product_tmpl_id", "barcode", "qty_available"],
    )
    report["samples"]["product.supplierinfo"] = action_sample(
        live, model="product.supplierinfo", limit=3,
        fields=["id", "partner_id", "product_tmpl_id", "product_code", "price", "currency_id", "min_qty", "delay"],
    )
    report["samples"]["res.partner"] = action_sample(
        live, model="res.partner", limit=3,
        fields=["id", "name", "email", "phone", "street", "city", "zip", "country_id", "lang",
                "customer_rank", "supplier_rank"],
    )
    report["categories"] = action_categories(live)
    return report


ACTIONS = {
    "ping": action_ping,
    "fields": action_fields,
    "sample": action_sample,
    "count": action_count,
    "categories": action_categories,
    "full-report": action_full_report,
}


class Command(BaseCommand):
    help = "READ-ONLY exploration of the v16 + v19 Odoo instances (CDC §5.10)."

    def add_arguments(self, parser):
        parser.add_argument("--action", required=True, choices=sorted(ACTIONS.keys()))
        parser.add_argument("--model", default="product.template")
        parser.add_argument("--limit", type=int, default=5)
        parser.add_argument("--fields", nargs="*", default=None)
        parser.add_argument(
            "--only", choices=["v16", "v19"], default=None,
            help="Restrict to a single instance.",
        )

    def handle(self, *args, **opts):
        labels = ["v16", "v19"] if opts["only"] is None else [opts["only"]]
        conns = [OdooConn.from_env(lbl) for lbl in labels]

        kwargs = {
            "model": opts["model"],
            "limit": opts["limit"],
            "fields": opts["fields"],
        }
        result = ACTIONS[opts["action"]](conns, **kwargs)
        self.stdout.write(json.dumps(result, indent=2, default=str, ensure_ascii=False))
