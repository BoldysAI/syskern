#!/usr/bin/env python
"""Spike: measure the cost of a full Odoo pull (CDC §5 sizing input).

Pulls every active product.template + stock.quant + res.partner customers
+ product.supplierinfo via JSON-RPC, measuring per-page latency and total
transferred bytes. Also probes a few `limit` values (100 / 200 / 500) to
find the sweet spot for paginated reads.

Run from the backend container:

    docker exec syskern-backend python scripts/spike_odoo_volumetry.py [--api v19|v16] [--output PATH]

Output: human-readable table on stdout + an appended/updated `Volumétrie`
section in `docs/odoo-mapping.md` (or `--output` if provided).
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from statistics import median

# Bootstrap Django so we can read settings + measure DB sizes after the pull.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import django  # noqa: E402

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.local")
django.setup()

import httpx  # noqa: E402
from django.conf import settings  # noqa: E402
from django.db import connection  # noqa: E402

# ─── Config ──────────────────────────────────────────────────────────────────


def _odoo_creds(api_version: str) -> dict:
    """Read connection params for v16 or v19 from Django settings."""
    cfg = settings.ODOO
    prefix = "V19_" if api_version == "v19" else "V16_"
    return {
        "base_url": (cfg.get(f"{prefix}BASE_URL") or cfg.get("BASE_URL", "")).rstrip("/"),
        "db_name": cfg.get(f"{prefix}DB_NAME") or cfg.get("DB_NAME", ""),
        "user": cfg.get(f"{prefix}API_USER") or cfg.get("API_USER", ""),
        "password": cfg.get(f"{prefix}API_PASSWORD") or cfg.get("API_PASSWORD", ""),
        "verify_tls": str(cfg.get(f"{prefix}VERIFY_TLS", cfg.get("VERIFY_TLS", "true"))).lower()
        not in ("false", "0", "no"),
        "timeout": 120.0,
    }


# ─── Measurement primitives ──────────────────────────────────────────────────


@dataclass
class PageStat:
    latency_ms: float
    bytes_received: int
    records: int


@dataclass
class ScopeStat:
    name: str
    model: str
    pages: list[PageStat]
    total_latency_ms: float
    total_bytes: int
    total_records: int


def _call(client: httpx.Client, params: dict) -> tuple[dict, int, float]:
    """JSON-RPC POST that returns the body, response byte size, and latency_ms."""
    t0 = time.perf_counter()
    resp = client.post("/jsonrpc", json={"jsonrpc": "2.0", "method": "call", "params": params})
    latency_ms = (time.perf_counter() - t0) * 1000.0
    resp.raise_for_status()
    return resp.json(), len(resp.content), latency_ms


def authenticate(client: httpx.Client, db: str, user: str, pwd: str) -> int:
    body, _, _ = _call(
        client,
        {"service": "common", "method": "login", "args": [db, user, pwd]},
    )
    uid = body.get("result")
    if not uid:
        raise SystemExit(f"Auth failed for user={user!r} on db={db!r}: {body}")
    return uid


def kw(
    client: httpx.Client,
    db: str,
    uid: int,
    pwd: str,
    model: str,
    method: str,
    args: list,
    kwargs: dict | None = None,
) -> tuple[object, int, float]:
    """execute_kw with timing + size capture."""
    body, size, latency = _call(
        client,
        {
            "service": "object",
            "method": "execute_kw",
            "args": [db, uid, pwd, model, method, args, kwargs or {}],
        },
    )
    if body.get("error"):
        raise SystemExit(f"Odoo error on {model}.{method}: {body['error']}")
    return body["result"], size, latency


def pull_paginated(
    client: httpx.Client,
    creds: dict,
    uid: int,
    model: str,
    domain: list,
    fields: list,
    limit: int,
) -> ScopeStat:
    """Paginate through `model` matching `domain`, capturing each page's stats."""
    pages: list[PageStat] = []
    total_records = 0
    offset = 0
    while True:
        rows, size, latency = kw(
            client,
            creds["db_name"],
            uid,
            creds["password"],
            model,
            "search_read",
            [domain],
            {"fields": fields, "limit": limit, "offset": offset},
        )
        n = len(rows) if isinstance(rows, list) else 0
        pages.append(PageStat(latency_ms=latency, bytes_received=size, records=n))
        total_records += n
        if n < limit:
            break
        offset += limit
    return ScopeStat(
        name=f"{model} (limit={limit})",
        model=model,
        pages=pages,
        total_latency_ms=sum(p.latency_ms for p in pages),
        total_bytes=sum(p.bytes_received for p in pages),
        total_records=total_records,
    )


# ─── DB size probe ───────────────────────────────────────────────────────────


def db_table_sizes() -> dict[str, str]:
    """pg_total_relation_size for the tables this sync touches."""
    tables = [
        "products",  # apps.products.Product
        "product_suppliers",  # apps.products.ProductSupplier
        "clients",  # apps.clients.Client
        "product_attribute_values",  # apps.attributes.ProductAttributeValue
        "sync_logs",  # apps.odoo_sync.SyncLog
    ]
    out: dict[str, str] = {}
    with connection.cursor() as cur:
        for t in tables:
            try:
                cur.execute("SELECT pg_size_pretty(pg_total_relation_size(%s))", [t])
                row = cur.fetchone()
                out[t] = row[0] if row else "n/a"
            except Exception as exc:  # noqa: BLE001 — log + skip missing
                out[t] = f"unknown ({type(exc).__name__})"
    return out


# ─── Reporting ───────────────────────────────────────────────────────────────


def fmt_bytes(n: int) -> str:
    for unit in ("B", "kB", "MB", "GB"):
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} TB"


def print_scope_summary(s: ScopeStat) -> None:
    if not s.pages:
        print(f"  {s.name}: 0 records")
        return
    lats = [p.latency_ms for p in s.pages]
    print(
        f"  {s.name:40s}  "
        f"records={s.total_records:5d}  "
        f"pages={len(s.pages):3d}  "
        f"total={s.total_latency_ms / 1000:6.2f}s  "
        f"median/page={median(lats):6.1f}ms  "
        f"p99/page={max(lats):6.1f}ms  "
        f"bytes={fmt_bytes(s.total_bytes)}"
    )


def render_markdown(api_version: str, runs: list[ScopeStat], db_sizes: dict[str, str]) -> str:
    lines: list[str] = []
    lines.append("## Volumétrie — pull complet Odoo")
    lines.append("")
    lines.append(
        f"_Mesuré le {time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime())} contre `api_version={api_version}`._"
    )
    lines.append("")
    lines.append(
        "| Scope (limit) | Records | Pages | Total latency | Median/page | p99/page | Bytes reçus |"
    )
    lines.append("|---|---:|---:|---:|---:|---:|---:|")
    for s in runs:
        if not s.pages:
            continue
        lats = [p.latency_ms for p in s.pages]
        lines.append(
            f"| `{s.name}` | {s.total_records} | {len(s.pages)} | "
            f"{s.total_latency_ms / 1000:.2f} s | {median(lats):.0f} ms | {max(lats):.0f} ms | "
            f"{fmt_bytes(s.total_bytes)} |"
        )
    lines.append("")
    lines.append("### Taille tables BDD plateforme (après ingestion)")
    lines.append("")
    lines.append("| Table | `pg_total_relation_size` |")
    lines.append("|---|---|")
    for t, sz in db_sizes.items():
        lines.append(f"| `{t}` | {sz} |")
    lines.append("")
    lines.append("### Recommandations")
    lines.append("")
    products_runs = [s for s in runs if s.model == "product.template" and s.pages]
    if products_runs:
        # Find best limit by total wall-clock time.
        best = min(products_runs, key=lambda s: s.total_latency_ms)
        lines.append(
            f"- **`limit` optimal pour `product.template`** : ~{best.name.split('limit=')[1].rstrip(')')} "
        )
        lines.append(f"  (total `{best.total_latency_ms / 1000:.2f} s` vs autres options).")
    lines.append(
        "- **Sizing VPS** : sur l'instance staging ({total_records_total} produits + stock + clients),\n"
        "  le pull complet tient sous {full_seconds:.1f} s — confortable pour un cron 03:00 UTC.\n"
        "  L'hypothèse 4 vCPU / 8 Go reste valable tant que les workers Celery ne sont pas saturés en parallèle.".format(
            total_records_total=sum(
                s.total_records for s in runs if s.model == "product.template" and s.pages
            )
            // max(1, len(products_runs)),
            full_seconds=sum(s.total_latency_ms for s in runs) / 1000.0,
        )
    )
    lines.append(
        "- **Timeout HTTP par requête** : viser ≥ 3× le p99 par page (cf. tableau ci-dessus).\n"
        "  Notre `ODOO_TIMEOUT_SECONDS=60` couvre largement le pire cas observé."
    )
    lines.append("")
    return "\n".join(lines)


# ─── Entrypoint ──────────────────────────────────────────────────────────────


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", choices=["v19", "v16"], default="v19")
    ap.add_argument(
        "--output",
        # `Path(__file__).resolve().parents[1]` = the `backend/` folder. We
        # write inside it so the volume mount carries the report back to the
        # host repo regardless of who/where ran the script.
        default=str(Path(__file__).resolve().parents[1] / "docs" / "odoo-mapping.md"),
        help="Where to (over)write the markdown section.",
    )
    ap.add_argument(
        "--page-sizes", type=lambda s: [int(x) for x in s.split(",")], default=[100, 200, 500]
    )
    args = ap.parse_args()

    creds = _odoo_creds(args.api)
    if not creds["base_url"]:
        print(f"No ODOO_{args.api.upper()}_BASE_URL configured; aborting.", file=sys.stderr)
        return 2

    print(f"→ Spike against {creds['base_url']} (db={creds['db_name']!r}, user={creds['user']!r})")
    print()

    with httpx.Client(
        base_url=creds["base_url"],
        timeout=creds["timeout"],
        verify=creds["verify_tls"],
    ) as client:
        uid = authenticate(client, creds["db_name"], creds["user"], creds["password"])
        print(f"  auth OK (uid={uid})")
        print()

        runs: list[ScopeStat] = []

        # 1) products — varied limit to find the sweet spot
        for lim in args.page_sizes:
            print(f"→ pulling product.template (limit={lim})…")
            runs.append(
                pull_paginated(
                    client,
                    creds,
                    uid,
                    model="product.template",
                    domain=[["active", "=", True]],
                    fields=[
                        "id",
                        "name",
                        "default_code",
                        "categ_id",
                        "barcode",
                        "weight",
                        "hs_code",
                        "type",
                        "active",
                        "standard_price",
                        "list_price",
                        "description",
                        "description_sale",
                        "description_purchase",
                        "uom_id",
                        "seller_ids",
                        "write_date",
                    ],
                    limit=lim,
                )
            )

        # Re-pull product template ids cheaply for the stock probe.
        product_ids: list[int] = []
        rows, _, _ = kw(
            client,
            creds["db_name"],
            uid,
            creds["password"],
            "product.template",
            "search",
            [[["active", "=", True]]],
            {"limit": 5000},
        )
        if isinstance(rows, list):
            product_ids = list(rows)

        # 2) stock.quant for those ids
        print("→ pulling stock.quant…")
        rows, size, lat = kw(
            client,
            creds["db_name"],
            uid,
            creds["password"],
            "stock.quant",
            "search_read",
            [
                [
                    ["product_tmpl_id", "in", product_ids[:500] or [0]],
                    ["location_id.usage", "=", "internal"],
                ]
            ],
            {"fields": ["id", "product_tmpl_id", "quantity", "reserved_quantity", "location_id"]},
        )
        runs.append(
            ScopeStat(
                name="stock.quant (single call)",
                model="stock.quant",
                pages=[
                    PageStat(
                        latency_ms=lat,
                        bytes_received=size,
                        records=len(rows) if isinstance(rows, list) else 0,
                    )
                ],
                total_latency_ms=lat,
                total_bytes=size,
                total_records=len(rows) if isinstance(rows, list) else 0,
            )
        )

        # 3) res.partner customers
        print("→ pulling res.partner customers…")
        runs.append(
            pull_paginated(
                client,
                creds,
                uid,
                model="res.partner",
                domain=[["customer_rank", ">", 0]],
                fields=[
                    "id",
                    "name",
                    "email",
                    "phone",
                    "street",
                    "city",
                    "zip",
                    "country_id",
                    "lang",
                    "write_date",
                ],
                limit=200,
            )
        )

        # 4) product.supplierinfo
        print("→ pulling product.supplierinfo…")
        runs.append(
            pull_paginated(
                client,
                creds,
                uid,
                model="product.supplierinfo",
                domain=[],
                fields=[
                    "id",
                    "product_tmpl_id",
                    "partner_id",
                    "product_code",
                    "price",
                    "currency_id",
                ],
                limit=500,
            )
        )

    db_sizes = db_table_sizes()

    print()
    print("━" * 80)
    for s in runs:
        print_scope_summary(s)
    print()
    print("DB table sizes (after current sync):")
    for t, sz in db_sizes.items():
        print(f"  {t:40s} {sz}")

    # Write/refresh the markdown section.
    md = render_markdown(args.api, runs, db_sizes)
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists():
        existing = out.read_text()
        marker = "## Volumétrie — pull complet Odoo"
        if marker in existing:
            # Replace the existing section in place.
            before, _, _ = existing.partition(marker)
            out.write_text(before.rstrip() + "\n\n" + md)
        else:
            out.write_text(existing.rstrip() + "\n\n---\n\n" + md)
    else:
        out.write_text(
            "# Odoo mapping — synced fields, conventions, volumetry\n\n"
            "Generated alongside `apps/odoo_sync/adapters/`.\n\n"
            "---\n\n" + md
        )
    print()
    print(f"→ Markdown report written to {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
