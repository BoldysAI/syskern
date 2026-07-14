"""Tests for the batch PO import (Épic FEEDBACK 1 — écart CDC §11.3).

The task is exercised in-process via `.apply()` (no worker / no broker), mirroring
the export task tests. Covers: update, create-link, rejects (unknown SKU / supplier
/ invalid PO), history writes, and the downloadable report.
"""

from __future__ import annotations

from pathlib import Path

import openpyxl
import pytest
from rest_framework.test import APIClient

from apps.products.models import Product, ProductSupplier, SupplierPriceHistory
from apps.suppliers.models import Supplier
from apps.suppliers.tasks import IMPORT_DIR, import_po_task

pytestmark = pytest.mark.django_db


def _write_xlsx(tmp_path: Path, rows: list[list], header=("SKU", "fournisseur", "PO")) -> Path:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(list(header))
    for row in rows:
        ws.append(row)
    path = tmp_path / "import.xlsx"
    wb.save(path)
    return path


@pytest.fixture()
def product() -> Product:
    return Product.objects.create(sku_code="IMP-SKU-01", name="Import test", is_active=True)


@pytest.fixture()
def supplier() -> Supplier:
    return Supplier.objects.create(name="Symea Shanghai", code="SYMEA-SH", currency_default="USD")


def _run(path: Path) -> dict:
    return import_po_task.apply(args=[str(path)]).result


class TestImportPo:
    def test_update_existing_link(self, tmp_path, product, supplier):
        link = ProductSupplier.objects.create(
            product=product, supplier=supplier, supplier_name=supplier.name, po_base_price="1.0000"
        )
        path = _write_xlsx(tmp_path, [[product.sku_code, supplier.name, "3.25"]])
        result = _run(path)

        assert result["updated"] == 1
        assert result["created"] == 0
        assert result["rejected"] == 0
        link.refresh_from_db()
        assert str(link.po_base_price) == "3.2500"
        assert (
            SupplierPriceHistory.objects.filter(product_supplier=link, source="import").count() == 1
        )

    def test_create_link_when_not_yet_linked(self, tmp_path, product, supplier):
        path = _write_xlsx(tmp_path, [[product.sku_code, supplier.name, "5"]])
        result = _run(path)

        assert result["created"] == 1
        link = ProductSupplier.objects.get(product=product, supplier=supplier)
        assert str(link.po_base_price) == "5.0000"
        # Pre-filled currency from the supplier default.
        assert link.po_currency == "USD"
        assert SupplierPriceHistory.objects.filter(product_supplier=link).count() == 1

    def test_reject_unknown_sku(self, tmp_path, supplier):
        path = _write_xlsx(tmp_path, [["NOPE", supplier.name, "1.0"]])
        result = _run(path)
        assert result["rejected"] == 1
        assert result["rejected_rows"][0]["reason"] == "SKU introuvable en base"

    def test_reject_unknown_supplier(self, tmp_path, product):
        path = _write_xlsx(tmp_path, [[product.sku_code, "Fournisseur Inconnu", "1.0"]])
        result = _run(path)
        assert result["rejected"] == 1
        assert "introuvable" in result["rejected_rows"][0]["reason"].lower()

    def test_reject_invalid_po(self, tmp_path, product, supplier):
        path = _write_xlsx(tmp_path, [[product.sku_code, supplier.name, "abc"]])
        result = _run(path)
        assert result["rejected"] == 1
        assert "PO invalide" in result["rejected_rows"][0]["reason"]

    def test_mixed_batch_does_not_block(self, tmp_path, product, supplier):
        path = _write_xlsx(
            tmp_path,
            [
                [product.sku_code, supplier.name, "2.0"],  # ok (create)
                ["NOPE", supplier.name, "1.0"],  # reject
                [product.sku_code, "Inconnu", "1.0"],  # reject
            ],
        )
        result = _run(path)
        assert result["created"] == 1
        assert result["rejected"] == 2
        # A report file is produced for the rejected rows.
        assert result["report_url"] is not None

    def test_report_written_to_disk(self, tmp_path, product, supplier):
        path = _write_xlsx(tmp_path, [["NOPE", supplier.name, "1.0"]])
        eager = import_po_task.apply(args=[str(path)])
        report_path = IMPORT_DIR / f"{eager.id}_report.xlsx"
        assert report_path.is_file()

    def test_supplier_name_matching_is_case_insensitive(self, tmp_path, product, supplier):
        path = _write_xlsx(tmp_path, [[product.sku_code, "symea shanghai", "9.0"]])
        result = _run(path)
        assert result["created"] == 1


class TestImportEndpoint:
    def test_missing_file_returns_400(self):
        client = APIClient()
        resp = client.post("/api/suppliers/import-po/", {}, format="multipart")
        assert resp.status_code == 400
