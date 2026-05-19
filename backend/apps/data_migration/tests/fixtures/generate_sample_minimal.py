"""Script to (re-)generate sample_minimal.xlsx.

Run once from the repo root:
    python backend/apps/data_migration/tests/fixtures/generate_sample_minimal.py

The fixture covers all five branches of the matcher and base-loader pipeline:
  Row 1 — SKU exact match (rule 1)
  Row 2 — parent_reference + factory_code match (rule 2)
  Row 3 — factory_code + category match (rule 3)
  Row 4 — no identifier at all → NO_SKU quarantine
  Row 5 — ambiguous factory+category (2 DB candidates) → DUPLICATE_MATCH quarantine

The test suite creates the matching DB products via factory-boy; this script
only produces the file — no DB access required.
"""
from __future__ import annotations

from pathlib import Path

import openpyxl

OUTPUT = Path(__file__).parent / "sample_minimal.xlsx"

HEADERS = [
    "sku_code",
    "parent_reference",
    "factory_code",
    "category",
    "description",
    "gtin",
    "copper_weight",
    "pallet_qty",
]

ROWS = [
    # 1: exact SKU match
    ("KCFU64PZHDGR5", "", "21", "COPPER|DATA CABLES|SOLID CABLE CAT6|", "CAT6 Cable grey 500m", "4897108881749", "17.5", "9"),
    # 2: parent_reference + factory_code match (no full SKU)
    ("", "KCFU64PZHDGR5", "21", "COPPER|DATA CABLES|SOLID CABLE CAT6|", "CAT6 Cable grey 500m v2", "", "", ""),
    # 3: factory_code + category only (last-resort)
    ("", "", "91", "COPPER|DATA CABLES|SOLID CABLE CAT6|F/UTP", "Orsean cable white 500m", "", "", "9"),
    # 4: no identifier at all → NO_SKU
    ("", "", "", "", "Mystery product with no code", "", "", ""),
    # 5: ambiguous factory+category → DUPLICATE_MATCH
    ("", "", "E02", "COPPER|DATA CABLES|SOLID CABLE CAT6|AMBIGUOUS", "Ambiguous Turkish cable", "", "17.0", ""),
]


def generate() -> None:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "products"
    ws.append(HEADERS)
    for row in ROWS:
        ws.append(list(row))
    wb.save(OUTPUT)
    print(f"Generated: {OUTPUT}")


if __name__ == "__main__":
    generate()
