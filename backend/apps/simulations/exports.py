"""Excel export for a simulation (CDC §6.9 — partage offline).

Builds a 3-sheet workbook from a `Simulation` and its lines:
  - "Synthèse"          : market params, chain summary, mix/margins, aggregates
  - "Résultats"         : one row per SKU with the UI table columns
  - "Breakdown détaillé": per line, the PA/PV chain step by step

Pure presentation — no pricing logic happens here (the engine already froze
every result on the lines).
"""

from __future__ import annotations

import io
from decimal import Decimal, InvalidOperation
from typing import TYPE_CHECKING

import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from apps.accounts.ui_locale import translate

if TYPE_CHECKING:
    from .models import Simulation, SimulationLine

_HEADER_FILL = PatternFill(start_color="1F3864", end_color="1F3864", fill_type="solid")
_HEADER_FONT = Font(color="FFFFFF", bold=True, size=10)
_SECTION_FONT = Font(bold=True, size=11, color="1F3864")
_ALT_FILL = PatternFill(start_color="EEF2F7", end_color="EEF2F7", fill_type="solid")
_EUR_FORMAT = "#,##0.00 €"

_RESULT_COLUMNS: list[tuple[str, int]] = [
    ("exports.sim.col.sku", 20),
    ("exports.sim.col.name", 40),
    ("exports.sim.col.range", 20),
    ("exports.sim.col.stock", 12),
    ("exports.sim.col.pamp", 16),
    ("exports.sim.col.pa", 14),
    ("exports.sim.col.pamp_pred", 20),
    ("exports.sim.col.pr", 14),
    ("exports.sim.col.margin", 16),
    ("exports.sim.col.mix", 14),
    ("exports.sim.col.pv", 14),
    ("exports.sim.col.status", 14),
]

_LINE_STATUS_KEYS = {
    "ok": "exports.sim.status.ok",
    "pending": "exports.sim.status.pending",
    "warning": "exports.sim.status.warning",
    "error": "exports.sim.status.error",
    "dirty": "exports.sim.status.dirty",
}

_TYPE_KEYS = {
    "tariff": "exports.sim.type.tariff",
    "project": "exports.sim.type.project",
}

_SIM_STATUS_KEYS = {
    "draft": "exports.sim.status.draft",
    "finalized": "exports.sim.status.finalized",
    "archived": "exports.sim.status.archived",
}

_BREAKDOWN_COLUMNS: list[tuple[str, int]] = [
    ("exports.sim.col.sku", 20),
    ("exports.sim.col.chain", 12),
    ("exports.sim.col.order", 8),
    ("exports.sim.col.module", 24),
    ("exports.sim.col.applied", 10),
    ("exports.sim.col.input", 16),
    ("exports.sim.col.currency", 10),
    ("exports.sim.col.output", 16),
    ("exports.sim.col.currency", 10),
]


def _t(locale: str, key: str, **kwargs: object) -> str:
    text = translate(key, locale)
    return text.format(**kwargs) if kwargs else text


def _choice(locale: str, mapping: dict[str, str], value: str, fallback: str) -> str:
    key = mapping.get(value)
    return _t(locale, key) if key else fallback


def _headers(locale: str, columns: list[tuple[str, int]]) -> list[tuple[str, int]]:
    return [(_t(locale, key), width) for key, width in columns]


def _num(value) -> float | None:
    """Coerce a Decimal/str money value to float for Excel numeric cells.

    Display-only conversion (the canonical Decimal stays in the DB / engine).
    """
    if value is None or value == "":
        return None
    try:
        return float(Decimal(str(value)))
    except (InvalidOperation, ValueError, TypeError):
        return None


def _style_header_row(ws, headers: list[tuple[str, int]]) -> None:
    for col_idx, (label, width) in enumerate(headers, start=1):
        cell = ws.cell(row=1, column=col_idx, value=label)
        cell.fill = _HEADER_FILL
        cell.font = _HEADER_FONT
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        ws.column_dimensions[get_column_letter(col_idx)].width = width
    ws.row_dimensions[1].height = 26
    ws.freeze_panes = "A2"


def _aggregate(lines: list[SimulationLine]) -> dict:
    pv = [v for v in (_num(ln.pv_eur) for ln in lines) if v is not None]
    pa = [v for v in (_num(ln.pa_net_eur) for ln in lines) if v is not None]
    pr = [v for v in (_num(ln.pr_eur) for ln in lines) if v is not None]
    return {
        "count": len(lines),
        "avg_pa": sum(pa) / len(pa) if pa else None,
        "avg_pr": sum(pr) / len(pr) if pr else None,
        "avg_pv": sum(pv) / len(pv) if pv else None,
        "min_pv": min(pv) if pv else None,
        "max_pv": max(pv) if pv else None,
        "warnings": sum(1 for ln in lines if ln.status == "warning"),
        "errors": sum(1 for ln in lines if ln.status == "error"),
    }


def _build_synthese(ws, simulation: Simulation, lines: list[SimulationLine], locale: str) -> None:
    ws.title = _t(locale, "exports.sim.sheet.summary")[:31]
    ws.column_dimensions["A"].width = 32
    ws.column_dimensions["B"].width = 32
    row = 1

    def section(title: str) -> None:
        nonlocal row
        cell = ws.cell(row=row, column=1, value=title)
        cell.font = _SECTION_FONT
        row += 1

    def kv(label: str, value, *, eur: bool = False) -> None:
        nonlocal row
        ws.cell(row=row, column=1, value=label).font = Font(bold=True)
        cell = ws.cell(row=row, column=2, value=value)
        if eur and isinstance(value, (int, float)):
            cell.number_format = _EUR_FORMAT
        row += 1

    section(_t(locale, "exports.sim.section.simulation"))
    kv(_t(locale, "exports.sim.label"), simulation.label)
    kv(
        _t(locale, "exports.sim.type"),
        _choice(
            locale,
            _TYPE_KEYS,
            simulation.simulation_type,
            simulation.get_simulation_type_display(),
        ),
    )
    kv(
        _t(locale, "exports.sim.status"),
        _choice(locale, _SIM_STATUS_KEYS, simulation.status, simulation.get_status_display()),
    )
    kv(_t(locale, "exports.sim.project"), simulation.project_name or "—")
    kv(
        _t(locale, "exports.sim.last_calculated"),
        simulation.last_calculated_at.strftime("%Y-%m-%d %H:%M")
        if simulation.last_calculated_at
        else "—",
    )
    kv(
        _t(locale, "exports.sim.odoo_snapshot"),
        simulation.odoo_snapshot_at.strftime("%Y-%m-%d %H:%M")
        if simulation.odoo_snapshot_at
        else "—",
    )
    row += 1

    section(_t(locale, "exports.sim.section.globals"))
    kv(_t(locale, "exports.sim.mix"), simulation.stock_purchase_mix_pct)
    kv(_t(locale, "exports.sim.symea_margin"), (_num(simulation.symea_margin_rate) or 0) * 100)
    kv(_t(locale, "exports.sim.syskern_margin"), (_num(simulation.syskern_margin_rate) or 0) * 100)
    row += 1

    section(_t(locale, "exports.sim.section.market"))
    for key, value in (simulation.market_params or {}).items():
        kv(str(key), str(value))
    if not (simulation.market_params or {}):
        kv("—", _t(locale, "exports.sim.no_market"))
    row += 1

    agg = _aggregate(lines)
    section(_t(locale, "exports.sim.section.aggregates"))
    kv(_t(locale, "exports.sim.line_count"), agg["count"])
    kv(_t(locale, "exports.sim.avg_pa"), agg["avg_pa"], eur=True)
    kv(_t(locale, "exports.sim.avg_pr"), agg["avg_pr"], eur=True)
    kv(_t(locale, "exports.sim.avg_pv"), agg["avg_pv"], eur=True)
    kv(_t(locale, "exports.sim.min_pv"), agg["min_pv"], eur=True)
    kv(_t(locale, "exports.sim.max_pv"), agg["max_pv"], eur=True)
    kv(_t(locale, "exports.sim.warnings"), agg["warnings"])
    kv(_t(locale, "exports.sim.errors"), agg["errors"])


def _build_resultats(ws, lines: list[SimulationLine], locale: str) -> None:
    ws.title = _t(locale, "exports.sim.sheet.results")[:31]
    _style_header_row(ws, _headers(locale, _RESULT_COLUMNS))
    eur_cols = {5, 6, 7, 8, 11}  # 1-based column indexes that hold EUR amounts

    for row_idx, line in enumerate(lines, start=2):
        product = line.product
        margin = _num(line.effective_margin_rate)
        values = [
            product.sku_code,
            product.designation,
            product.range,
            _num(product.stock_quantity),
            _num(product.pamp_eur),
            _num(line.pa_net_eur),
            _num(line.pamp_predictive_eur),
            _num(line.pr_eur),
            round(margin * 100, 2) if margin is not None else None,
            line.effective_mix_pct,
            _num(line.pv_eur),
            _choice(locale, _LINE_STATUS_KEYS, line.status, line.status),
        ]
        for col_idx, value in enumerate(values, start=1):
            cell = ws.cell(row=row_idx, column=col_idx, value=value)
            if col_idx in eur_cols and isinstance(value, (int, float)):
                cell.number_format = _EUR_FORMAT
            if row_idx % 2 == 0:
                cell.fill = _ALT_FILL
            cell.alignment = Alignment(vertical="center")


def _build_breakdown(ws, lines: list[SimulationLine], locale: str) -> None:
    ws.title = _t(locale, "exports.sim.sheet.breakdown")[:31]
    _style_header_row(ws, _headers(locale, _BREAKDOWN_COLUMNS))
    yes = _t(locale, "exports.yes")
    no = _t(locale, "exports.no")
    row = 2

    for line in lines:
        breakdown = line.calculation_breakdown or {}
        if "error" in breakdown:
            ws.cell(row=row, column=1, value=line.product.sku_code)
            ws.cell(
                row=row,
                column=4,
                value=_t(locale, "exports.sim.error_prefix", error=breakdown["error"]),
            )
            row += 1
            continue
        for chain_key, chain_label in (("purchase", "PA"), ("sale", "PV")):
            chain = breakdown.get(chain_key) or {}
            for step in chain.get("steps", []):
                inp = step.get("input_price", {})
                out = step.get("output_price", {})
                ws.cell(row=row, column=1, value=line.product.sku_code)
                ws.cell(row=row, column=2, value=chain_label)
                ws.cell(row=row, column=3, value=step.get("order"))
                ws.cell(row=row, column=4, value=step.get("module"))
                ws.cell(row=row, column=5, value=yes if step.get("applied") else no)
                c_in = ws.cell(row=row, column=6, value=_num(inp.get("amount")))
                c_in.number_format = "#,##0.0000"
                ws.cell(row=row, column=7, value=inp.get("currency"))
                c_out = ws.cell(row=row, column=8, value=_num(out.get("amount")))
                c_out.number_format = "#,##0.0000"
                ws.cell(row=row, column=9, value=out.get("currency"))
                row += 1


def build_simulation_xlsx(simulation: Simulation, locale: str = "fr") -> bytes:
    """Build the multi-sheet Excel workbook for *simulation* and return bytes.

    The simulation should be loaded with `lines__product` prefetched.
    *locale* selects structural labels only. Product names, ranges, market
    parameter keys and stored engine diagnostics stay as recorded.
    """
    lines = list(simulation.lines.select_related("product").all())
    wb = openpyxl.Workbook()

    _build_synthese(wb.active, simulation, lines, locale)
    _build_resultats(wb.create_sheet(), lines, locale)
    _build_breakdown(wb.create_sheet(), lines, locale)

    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()
