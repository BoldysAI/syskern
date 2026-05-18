"""Excel export for the product catalog (CDC §4.1.1).

Generates a .xlsx workbook from an arbitrary Product queryset.
"""
from __future__ import annotations

import io
from typing import TYPE_CHECKING

import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

if TYPE_CHECKING:
    from django.db.models import QuerySet

    from .models import Product

# ─── Column definitions ───────────────────────────────────────────────────────

# (header label, attribute accessor, column width)
_COLUMNS: list[tuple[str, str, int]] = [
    ("SKU", "sku_code", 20),
    ("Nom", "name", 40),
    ("Univers", "universe", 20),
    ("Famille", "family", 20),
    ("Gamme", "range", 20),
    ("Sous-gamme", "sub_range", 20),
    ("Marque", "brand", 16),
    ("Stock (unités)", "stock_quantity", 16),
    ("PAMP (EUR)", "pamp_eur", 14),
    ("Indexé cuivre", "is_copper_indexed", 14),
    ("Actif", "is_active", 10),
]

_HEADER_FILL = PatternFill(start_color="1F3864", end_color="1F3864", fill_type="solid")
_HEADER_FONT = Font(color="FFFFFF", bold=True, size=10)
_ALT_FILL = PatternFill(start_color="EEF2F7", end_color="EEF2F7", fill_type="solid")


def _active_supplier_name(product: Product) -> str:
    for s in product.suppliers.all():
        if s.is_active:
            return s.supplier_name
    return ""


def build_products_xlsx(queryset: QuerySet[Product]) -> bytes:
    """Build an Excel workbook from *queryset* and return the raw bytes.

    The queryset should already have `prefetch_related("suppliers")` applied
    for efficient supplier name resolution.
    """
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Catalogue produits"

    # Build header row including the "Fournisseur actif" special column.
    all_columns = _COLUMNS[:9] + [("Fournisseur actif", "__active_supplier__", 24)] + _COLUMNS[9:]

    for col_idx, (label, _, width) in enumerate(all_columns, start=1):
        cell = ws.cell(row=1, column=col_idx, value=label)
        cell.fill = _HEADER_FILL
        cell.font = _HEADER_FONT
        cell.alignment = Alignment(horizontal="center", vertical="center")
        ws.column_dimensions[get_column_letter(col_idx)].width = width

    ws.row_dimensions[1].height = 20
    ws.freeze_panes = "A2"

    for row_idx, product in enumerate(queryset, start=2):
        for col_idx, (_label, attr, _) in enumerate(all_columns, start=1):
            if attr == "__active_supplier__":
                value = _active_supplier_name(product)
            elif attr in {"is_copper_indexed", "is_active"}:
                value = "Oui" if getattr(product, attr) else "Non"
            else:
                raw = getattr(product, attr, None)
                value = str(raw) if raw is not None else ""

            cell = ws.cell(row=row_idx, column=col_idx, value=value)
            if row_idx % 2 == 0:
                cell.fill = _ALT_FILL
            cell.alignment = Alignment(vertical="center")

    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()
