"""Tests for the flexible PO import wizard (Épic FEEDBACK 1 — écart CDC §11.3).

Covers the analyze → inspect → preview → apply flow with **index-based** column
mappings (so unnamed columns and non-first header rows work), the supplier
resolution rules (mapped column wins, else the step-1 default), the edge cases
(SKU unknown = shown/no-op, supplier unknown = rejected, unlinked SKU = link
created) and the reusable mapping templates.

The Celery tasks are exercised in-process via ``.apply()`` (no worker / broker),
mirroring the export task tests.
"""

from __future__ import annotations

from pathlib import Path

import openpyxl
import pytest
from rest_framework.test import APIClient

from apps.products.models import Product, ProductSupplier, SupplierPriceHistory
from apps.suppliers.models import Supplier, SupplierImportMapping
from apps.suppliers.services_import import apply_import, preview_import, read_excel_headers
from apps.suppliers.tasks import IMPORT_DIR, import_po_apply_task

pytestmark = pytest.mark.django_db


def _write_xlsx(tmp_path: Path, rows: list[list], name: str = "import.xlsx") -> Path:
    """Write raw rows verbatim (caller supplies header/title rows)."""
    wb = openpyxl.Workbook()
    ws = wb.active
    for row in rows:
        ws.append(row)
    path = tmp_path / name
    wb.save(path)
    return path


@pytest.fixture()
def product() -> Product:
    return Product.objects.create(sku_code="IMP-SKU-01", name="Import test", is_active=True)


@pytest.fixture()
def supplier() -> Supplier:
    return Supplier.objects.create(name="Symea Shanghai", code="SYMEA-SH", currency_default="USD")


class TestAnalyze:
    def test_reads_arbitrary_headers_and_sample(self, tmp_path):
        path = _write_xlsx(
            tmp_path,
            [["Item Code", "Prix Achat 2026", "Notes"], ["ABC", "3.5", "x"], ["DEF", "4", "y"]],
        )
        headers, sample, column_count = read_excel_headers(path)
        assert headers == ["Item Code", "Prix Achat 2026", "Notes"]
        assert column_count == 3
        assert len(sample) == 2
        assert sample[0][0] == "ABC"

    def test_header_row_offset(self, tmp_path):
        # Row 1 = title, row 2 = real header, rows 3+ = data.
        path = _write_xlsx(
            tmp_path,
            [
                ["APERCU DU FICHIER", None, None],
                ["Sub-Range", "Type", "PO"],
                ["ABC", "central tube", "3.25"],
            ],
        )
        headers, sample, column_count = read_excel_headers(path, header_row=2)
        assert headers == ["Sub-Range", "Type", "PO"]
        assert sample[0] == ["ABC", "central tube", "3.25"]

    def test_unnamed_columns_are_counted(self, tmp_path):
        # Header row has a blank middle column but data fills it.
        path = _write_xlsx(tmp_path, [["SKU", "", "PO"], ["ABC", "middle", "3.25"]])
        headers, _sample, column_count = read_excel_headers(path)
        assert column_count == 3
        assert headers[1] == ""  # unnamed but still addressable by index 1

    def test_header_beyond_file_raises(self, tmp_path):
        path = _write_xlsx(tmp_path, [["SKU", "PO"]])
        with pytest.raises(ValueError, match="en-tête"):
            read_excel_headers(path, header_row=5)


class TestPreview:
    def test_maps_by_index(self, tmp_path, product, supplier):
        ProductSupplier.objects.create(
            product=product, supplier=supplier, supplier_name=supplier.name, po_base_price="1.0000"
        )
        path = _write_xlsx(tmp_path, [["Item Code", "Prix"], [product.sku_code, "3.25"]])
        result = preview_import(path, column_map={"sku": 0, "po": 1}, default_supplier=supplier)
        assert result["summary"]["will_update"] == 1
        assert result["lines"][0]["new_po_base_price"] == "3.2500"
        # Pure read — nothing persisted.
        product.suppliers.get().refresh_from_db()
        assert str(product.suppliers.get().po_base_price) == "1.0000"

    def test_unnamed_column_is_mappable(self, tmp_path, product, supplier):
        # PO sits in an unnamed column (index 2).
        path = _write_xlsx(tmp_path, [["SKU", "Notes", ""], [product.sku_code, "x", "9.9"]])
        result = preview_import(path, column_map={"sku": 0, "po": 2}, default_supplier=supplier)
        assert result["summary"]["will_create_link"] == 1
        assert result["lines"][0]["new_po_base_price"] == "9.9000"

    def test_header_row_two(self, tmp_path, product, supplier):
        path = _write_xlsx(
            tmp_path,
            [["TITRE", None], ["SKU", "PO"], [product.sku_code, "5"]],
        )
        result = preview_import(
            path, column_map={"sku": 0, "po": 1}, default_supplier=supplier, header_row=2
        )
        assert result["summary"]["will_create_link"] == 1
        assert result["lines"][0]["row"] == 3  # actual Excel row of the data line

    def test_unknown_sku_shown_not_error(self, tmp_path, supplier):
        path = _write_xlsx(tmp_path, [["SKU", "PO"], ["NOPE", "2"]])
        result = preview_import(path, column_map={"sku": 0, "po": 1}, default_supplier=supplier)
        assert result["summary"]["sku_not_found"] == 1


class TestApply:
    def test_update_and_history(self, tmp_path, product, supplier):
        link = ProductSupplier.objects.create(
            product=product, supplier=supplier, supplier_name=supplier.name, po_base_price="1.0000"
        )
        path = _write_xlsx(tmp_path, [["Ref", "Cost"], [product.sku_code, "9.5"]])
        result = apply_import(path, column_map={"sku": 0, "po": 1}, default_supplier=supplier)
        assert result["updated"] == 1
        link.refresh_from_db()
        assert str(link.po_base_price) == "9.5000"
        assert (
            SupplierPriceHistory.objects.filter(product_supplier=link, source="import").count() == 1
        )

    def test_create_link_prefilled(self, tmp_path, product, supplier):
        path = _write_xlsx(tmp_path, [["Ref", "Cost"], [product.sku_code, "5"]])
        result = apply_import(path, column_map={"sku": 0, "po": 1}, default_supplier=supplier)
        assert result["created"] == 1
        link = ProductSupplier.objects.get(product=product, supplier=supplier)
        assert link.po_currency == "USD"  # supplier default

    def test_optional_fields_applied_on_create(self, tmp_path, product, supplier):
        path = _write_xlsx(
            tmp_path,
            [["Ref", "Cost", "Devise", "Incoterm"], [product.sku_code, "5", "EUR", "FOB"]],
        )
        apply_import(
            path,
            column_map={"sku": 0, "po": 1, "po_currency": 2, "incoterm": 3},
            default_supplier=supplier,
        )
        link = ProductSupplier.objects.get(product=product, supplier=supplier)
        assert link.po_currency == "EUR"
        assert link.incoterm == "FOB"

    def test_unknown_sku_no_op(self, tmp_path, supplier):
        path = _write_xlsx(tmp_path, [["SKU", "PO"], ["NOPE", "2"]])
        result = apply_import(path, column_map={"sku": 0, "po": 1}, default_supplier=supplier)
        assert result["updated"] == 0
        assert result["created"] == 0
        assert result["rejected"] == 1
        assert ProductSupplier.objects.count() == 0


class TestMultiSupplier:
    def test_column_wins_over_default(self, tmp_path, product):
        s1 = Supplier.objects.create(name="Alpha", code="ALPHA")
        s2 = Supplier.objects.create(name="Beta", code="BETA")
        path = _write_xlsx(
            tmp_path, [["SKU", "Fournisseur", "PO"], [product.sku_code, "Beta", "7"]]
        )
        apply_import(
            path,
            column_map={"sku": 0, "supplier": 1, "po": 2},
            default_supplier=s1,
        )
        assert ProductSupplier.objects.filter(product=product, supplier=s2).exists()
        assert not ProductSupplier.objects.filter(product=product, supplier=s1).exists()

    def test_empty_column_falls_back_to_default(self, tmp_path, product, supplier):
        path = _write_xlsx(tmp_path, [["SKU", "Fournisseur", "PO"], [product.sku_code, "", "7"]])
        apply_import(path, column_map={"sku": 0, "supplier": 1, "po": 2}, default_supplier=supplier)
        assert ProductSupplier.objects.filter(product=product, supplier=supplier).exists()

    def test_unknown_column_supplier_rejected(self, tmp_path, product, supplier):
        path = _write_xlsx(
            tmp_path, [["SKU", "Fournisseur", "PO"], [product.sku_code, "Inconnu SARL", "7"]]
        )
        result = apply_import(
            path, column_map={"sku": 0, "supplier": 1, "po": 2}, default_supplier=supplier
        )
        assert result["rejected"] == 1
        assert not ProductSupplier.objects.exists()

    def test_no_supplier_at_all(self, tmp_path, product):
        path = _write_xlsx(tmp_path, [["SKU", "PO"], [product.sku_code, "7"]])
        result = preview_import(path, column_map={"sku": 0, "po": 1}, default_supplier=None)
        assert result["summary"]["no_supplier"] == 1


class TestApplyTask:
    def test_report_written(self, tmp_path, product, supplier):
        path = _write_xlsx(tmp_path, [["SKU", "PO"], ["NOPE", "2"]])
        eager = import_po_apply_task.apply(
            args=[str(path), {"sku": 0, "po": 1}, str(supplier.id), 1]
        )
        result = eager.result
        assert result["rejected"] == 1
        assert result["report_url"] is not None
        report_path = IMPORT_DIR / f"{eager.id}_report.xlsx"
        assert report_path.is_file()


class TestEndpoints:
    def _analyze(self, client, path, header_row=1):
        with path.open("rb") as fh:
            return client.post(
                "/api/suppliers/import-po/analyze/",
                {"file": fh, "header_row": header_row},
                format="multipart",
            )

    def test_analyze_returns_headers_and_count(self, tmp_path):
        path = _write_xlsx(tmp_path, [["Item", "", "Price"], ["A", "m", "1"]])
        client = APIClient()
        resp = self._analyze(client, path)
        assert resp.status_code == 200
        body = resp.json()
        assert body["headers"] == ["Item", "", "Price"]
        assert body["column_count"] == 3
        assert body["header_row"] == 1
        assert "upload_token" in body

    def test_inspect_changes_header_row(self, tmp_path):
        path = _write_xlsx(tmp_path, [["TITRE", None], ["SKU", "PO"], ["A", "1"]])
        client = APIClient()
        token = self._analyze(client, path).json()["upload_token"]
        resp = client.post(
            "/api/suppliers/import-po/inspect/",
            {"upload_token": token, "header_row": 2},
            format="json",
        )
        assert resp.status_code == 200
        assert resp.json()["headers"] == ["SKU", "PO"]

    def test_analyze_missing_file_400(self):
        client = APIClient()
        resp = client.post("/api/suppliers/import-po/analyze/", {}, format="multipart")
        assert resp.status_code == 400

    def test_preview_bad_token_400(self):
        client = APIClient()
        resp = client.post(
            "/api/suppliers/import-po/preview/",
            {"upload_token": "not-a-token", "column_map": {"sku": 0, "po": 1}},
            format="json",
        )
        assert resp.status_code == 400

    def test_preview_missing_required_field_400(self, tmp_path):
        path = _write_xlsx(tmp_path, [["Item", "Price"], ["A", "1"]])
        client = APIClient()
        token = self._analyze(client, path).json()["upload_token"]
        resp = client.post(
            "/api/suppliers/import-po/preview/",
            {"upload_token": token, "column_map": {"sku": 0}},
            format="json",
        )
        assert resp.status_code == 400


class TestMappingCrud:
    def test_create_and_list(self, supplier):
        client = APIClient()
        resp = client.post(
            "/api/suppliers/import-mappings/",
            {
                "name": "Structure X",
                "supplier": str(supplier.id),
                "column_map": {"sku": 0, "po": 3},
                "header_row": 2,
            },
            format="json",
        )
        assert resp.status_code == 201, resp.content
        assert SupplierImportMapping.objects.count() == 1
        obj = SupplierImportMapping.objects.get()
        assert obj.header_row == 2
        assert obj.column_map == {"sku": 0, "po": 3}

        listed = client.get(f"/api/suppliers/import-mappings/?supplier={supplier.id}")
        assert listed.status_code == 200
        assert listed.json()["count"] == 1

    def test_reject_missing_required_field(self):
        client = APIClient()
        resp = client.post(
            "/api/suppliers/import-mappings/",
            {"name": "Bad", "column_map": {"sku": 0}},
            format="json",
        )
        assert resp.status_code == 400
