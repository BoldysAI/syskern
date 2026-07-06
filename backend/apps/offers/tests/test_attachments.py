"""Document-library ↔ offer integration (CDC §7.4.4): the library's real use case.

Attach documents to an offer → the output bundles them: tariff → ZIP (Excel +
annexes), project → merged PDF (Gamma quote + annexes). Language resolves with
FR fallback (§7.4.2). These are the integration tests the library was missing.
"""

from __future__ import annotations

import io
import zipfile

import pytest
from pypdf import PdfReader, PdfWriter
from rest_framework.test import APIClient

from apps.documents.models import DocumentCategory, DocumentLibrary
from apps.offers.models import ExportFormat, Offer, OfferStatus, OfferType
from apps.offers.services import attachments as att
from apps.offers.tasks import offer_export_path
from apps.simulations.models import Simulation

pytestmark = pytest.mark.django_db


def _pdf(n_pages: int = 1) -> bytes:
    writer = PdfWriter()
    for _ in range(n_pages):
        writer.add_blank_page(width=200, height=200)
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


def _doc(**kw) -> DocumentLibrary:
    defaults = {
        "name": {"fr": "CGV"},
        "category": DocumentCategory.CGV,
        "file_url": "documents/x.pdf",
        "file_name": "cgv.pdf",
        "is_active": True,
    }
    defaults.update(kw)
    return DocumentLibrary.objects.create(**defaults)


# ── Language resolution (FR fallback) ─────────────────────────────────────────


def test_resolve_prefers_target_language():
    fr = _doc(language="fr", file_name="cgv.pdf")
    en = _doc(language="en", file_name="cgv.pdf")
    assert [d.id for d in att.resolve_attached_documents([fr.id], "en")] == [en.id]


def test_resolve_falls_back_to_selected_when_no_sibling():
    fr = _doc(language="fr", file_name="cgv.pdf")
    assert [d.id for d in att.resolve_attached_documents([fr.id], "es")] == [fr.id]


def test_resolve_skips_inactive():
    d = _doc(is_active=False)
    assert att.resolve_attached_documents([d.id], "fr") == []


def test_resolve_empty_is_noop():
    assert att.resolve_attached_documents([], "fr") == []
    assert att.resolve_attached_documents(None, "fr") == []


# ── ZIP bundling (tariff) ─────────────────────────────────────────────────────


def test_bundle_zip_contains_main_and_annexes(monkeypatch):
    d = _doc(file_name="cgv.pdf")
    monkeypatch.setattr(att, "_read_bytes", lambda doc: b"PDFDATA")
    zf = zipfile.ZipFile(io.BytesIO(att.bundle_zip("tarif.xlsx", b"XLSXDATA", [d])))
    assert "tarif.xlsx" in zf.namelist()
    assert "annexes/cgv.pdf" in zf.namelist()
    assert zf.read("tarif.xlsx") == b"XLSXDATA"


# ── PDF merge (project) ───────────────────────────────────────────────────────


def test_merge_pdfs_concatenates_pages(monkeypatch):
    annex = _doc()
    monkeypatch.setattr(att, "_read_bytes", lambda doc: _pdf(2))
    merged = att.merge_pdfs(_pdf(1), [annex])
    assert len(PdfReader(io.BytesIO(merged)).pages) == 3


def test_merge_pdfs_skips_non_pdf(monkeypatch):
    annex = _doc()
    monkeypatch.setattr(att, "_read_bytes", lambda doc: b"not a pdf")
    merged = att.merge_pdfs(_pdf(1), [annex])
    assert len(PdfReader(io.BytesIO(merged)).pages) == 1  # annex skipped, quote kept


# ── End-to-end via the download endpoint ──────────────────────────────────────


def test_download_tariff_zips_with_attachments(monkeypatch):
    sim = Simulation.objects.create(label="S", simulation_type="tariff", status="finalized")
    doc = _doc(file_name="cgv.pdf")
    offer = Offer.objects.create(
        simulation=sim,
        offer_type=OfferType.TARIFF,
        label="T",
        currency="EUR",
        incoterm="EXW",
        export_format=ExportFormat.EXCEL,
        status=OfferStatus.DRAFT,
        attached_document_ids=[doc.id],
    )
    path = offer_export_path(offer.id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"XLSXDATA")
    monkeypatch.setattr(att, "_read_bytes", lambda d: b"PDFDATA")

    resp = APIClient().get(f"/api/offers/{offer.id}/download/")
    assert resp.status_code == 200
    assert resp["Content-Type"] == "application/zip"
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    assert f"tarif_{offer.id}.xlsx" in zf.namelist()
    assert "annexes/cgv.pdf" in zf.namelist()
    path.unlink(missing_ok=True)


def test_download_project_merges_pdf(monkeypatch):
    sim = Simulation.objects.create(label="S", simulation_type="project", status="finalized")
    doc = _doc()
    offer = Offer.objects.create(
        simulation=sim,
        offer_type=OfferType.PROJECT,
        label="P",
        currency="EUR",
        incoterm="EXW",
        export_format=ExportFormat.DEVIS_GAMMA,
        status=OfferStatus.DRAFT,
        attached_document_ids=[doc.id],
        project_info={"gamma_export_url": "https://gamma/export.pdf"},
    )
    monkeypatch.setattr(att, "fetch_pdf", lambda url, **kw: _pdf(1))
    monkeypatch.setattr(att, "_read_bytes", lambda d: _pdf(2))

    resp = APIClient().get(f"/api/offers/{offer.id}/download/")
    assert resp.status_code == 200
    assert resp["Content-Type"] == "application/pdf"
    assert resp["Content-Disposition"].startswith("attachment")  # default = download
    assert len(PdfReader(io.BytesIO(resp.content)).pages) == 3  # quote (1) + annex (2)

    # ?inline=1 → viewable in the browser (still the merged PDF).
    inline = APIClient().get(f"/api/offers/{offer.id}/download/?inline=1")
    assert inline.status_code == 200
    assert inline["Content-Type"] == "application/pdf"
    assert inline["Content-Disposition"].startswith("inline")
    assert len(PdfReader(io.BytesIO(inline.content)).pages) == 3
