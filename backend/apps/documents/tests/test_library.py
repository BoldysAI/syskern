"""Tests for the document library (CDC §7.4): upload, versioning, soft-delete,
download, version chain, product SET_NULL, and the 30-day purge task."""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.core.files.storage import FileSystemStorage
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from rest_framework.test import APIClient

from apps.documents.models import DocumentLibrary
from apps.documents.tasks import purge_deleted_documents
from apps.products.models import Product

pytestmark = pytest.mark.django_db

_PDF = b"%PDF-1.4 fake pdf bytes"


@pytest.fixture()
def client_api() -> APIClient:
    return APIClient()


@pytest.fixture()
def storage(tmp_path, monkeypatch):
    """Isolate file writes to a tmp dir (shared by views + purge task)."""
    st = FileSystemStorage(location=str(tmp_path))
    monkeypatch.setattr("apps.documents.views.default_storage", st)
    monkeypatch.setattr("apps.documents.tasks.default_storage", st)
    return st


def _upload(client, *, name="cgv.pdf", content=_PDF, content_type="application/pdf", **data):
    payload = {
        "file": SimpleUploadedFile(name, content, content_type=content_type),
        "category": data.pop("category", "cgv"),
        "language": data.pop("language", "fr"),
        **data,
    }
    return client.post("/api/document-library/upload/", payload, format="multipart")


# ── Upload + validation ───────────────────────────────────────────────────────


def test_upload_pdf_ok(client_api, storage):
    resp = _upload(client_api)
    assert resp.status_code == 201
    body = resp.json()
    assert body["version"] == 1
    assert body["file_name"] == "cgv.pdf"
    assert body["mime_type"] == "application/pdf"
    assert body["download_url"].endswith(f"/{body['id']}/download/")
    assert DocumentLibrary.objects.count() == 1


def test_upload_rejects_oversize(client_api, storage):
    big = b"x" * (20 * 1024 * 1024 + 1)
    resp = _upload(client_api, name="big.pdf", content=big)
    assert resp.status_code == 400
    assert "20" in resp.json()["detail"]


def test_upload_rejects_bad_type(client_api, storage):
    resp = _upload(
        client_api, name="evil.exe", content=b"MZ", content_type="application/x-msdownload"
    )
    assert resp.status_code == 400
    assert DocumentLibrary.objects.count() == 0


def test_upload_missing_file(client_api, storage):
    resp = client_api.post("/api/document-library/upload/", {"category": "cgv"}, format="multipart")
    assert resp.status_code == 400


# ── Versioning ────────────────────────────────────────────────────────────────


def test_versioning_bumps_on_same_name_lang_product(client_api, storage):
    p = Product.objects.create(sku_code="SKU-1", name="P1")
    v1 = _upload(
        client_api, name="datasheet.pdf", category="quality", language="en", product=str(p.id)
    )
    v2 = _upload(
        client_api, name="datasheet.pdf", category="quality", language="en", product=str(p.id)
    )
    assert v1.json()["version"] == 1
    assert v2.json()["version"] == 2

    # Different language → independent version 1.
    other = _upload(
        client_api, name="datasheet.pdf", category="quality", language="fr", product=str(p.id)
    )
    assert other.json()["version"] == 1


def test_versions_endpoint_returns_chain(client_api, storage):
    _upload(client_api, name="warranty.pdf", category="warranty", language="fr")
    _upload(client_api, name="warranty.pdf", category="warranty", language="fr")
    doc = DocumentLibrary.objects.order_by("version").first()
    resp = client_api.get(f"/api/document-library/{doc.id}/versions/")
    assert resp.status_code == 200
    assert [d["version"] for d in resp.json()] == [1, 2]


# ── Download ──────────────────────────────────────────────────────────────────


def test_download_streams_file(client_api, storage):
    doc_id = _upload(client_api).json()["id"]
    resp = client_api.get(f"/api/document-library/{doc_id}/download/")
    assert resp.status_code == 200
    assert b"".join(resp.streaming_content) == _PDF


def test_inline_download_allows_same_origin_framing(client_api, storage):
    """Inline preview is embedded in an <iframe>; the site-wide DENY must be
    relaxed to SAMEORIGIN for this response, else prod blocks it with
    ERR_BLOCKED_BY_RESPONSE."""
    doc_id = _upload(client_api).json()["id"]
    resp = client_api.get(f"/api/document-library/{doc_id}/download/?inline=1")
    assert resp.status_code == 200
    assert resp.headers["X-Frame-Options"] == "SAMEORIGIN"
    assert "attachment" not in resp.headers.get("Content-Disposition", "")


# ── Soft delete + recovery + purge ────────────────────────────────────────────


def test_delete_is_soft(client_api, storage):
    doc_id = _upload(client_api).json()["id"]
    resp = client_api.delete(f"/api/document-library/{doc_id}/")
    assert resp.status_code == 204
    doc = DocumentLibrary.objects.get(id=doc_id)  # row still there
    assert doc.is_active is False
    assert doc.deleted_at is not None
    # File preserved → still downloadable (recovery window).
    assert client_api.get(f"/api/document-library/{doc_id}/download/").status_code == 200
    # Hidden from the default list.
    assert client_api.get("/api/document-library/").json()["count"] == 0


def test_purge_removes_after_30_days(client_api, storage):
    doc_id = _upload(client_api).json()["id"]
    doc = DocumentLibrary.objects.get(id=doc_id)
    doc.is_active = False
    doc.deleted_at = timezone.now() - timedelta(days=31)
    doc.save()

    result = purge_deleted_documents()
    assert result["purged"] == 1
    assert result["files_removed"] == 1
    assert not DocumentLibrary.objects.filter(id=doc_id).exists()
    assert not storage.exists(doc.file_url)


def test_purge_keeps_recent_and_active(client_api, storage):
    recent_id = _upload(client_api, name="a.pdf").json()["id"]
    active_id = _upload(client_api, name="b.pdf").json()["id"]
    recent = DocumentLibrary.objects.get(id=recent_id)
    recent.is_active = False
    recent.deleted_at = timezone.now() - timedelta(days=29)  # within window
    recent.save()

    assert purge_deleted_documents()["purged"] == 0
    assert DocumentLibrary.objects.filter(id=recent_id).exists()
    assert DocumentLibrary.objects.filter(id=active_id).exists()


# ── Product link SET_NULL ─────────────────────────────────────────────────────


def test_product_delete_sets_null(client_api, storage):
    p = Product.objects.create(sku_code="SKU-X", name="X")
    doc_id = _upload(client_api, product=str(p.id)).json()["id"]
    assert DocumentLibrary.objects.get(id=doc_id).product_id == p.id
    p.delete()
    assert DocumentLibrary.objects.get(id=doc_id).product_id is None


# ── List filters (sidebar multi-select, CDC §7.4) ─────────────────────────────


def test_list_multi_select_category_and_language(client_api, storage):
    _upload(client_api, name="a.pdf", category="cgv", language="fr")
    _upload(client_api, name="b.pdf", category="warranty", language="en")
    _upload(client_api, name="c.pdf", category="quality", language="es")

    def count(qs: str) -> int:
        return client_api.get(f"/api/document-library/?{qs}").json()["count"]

    # CSV multi-select ORs the values.
    assert count("category=cgv,warranty") == 2
    assert count("category=quality") == 1
    assert count("language=fr,es") == 2
    # Combined category + language narrows.
    assert count("category=cgv,warranty&language=fr") == 1
    # Unknown / empty tokens are a no-op (never a 500).
    assert count("category=bogus") == 3
    assert count("category=") == 3
