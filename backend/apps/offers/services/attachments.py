"""Bundle library documents into a generated offer's output (CDC §7.4.4).

- **Tariff** (Excel) → a ZIP holding the workbook + the selected documents.
- **Project** (Gamma quote) → a single merged PDF: the Gamma export followed by
  the document annexes (non-PDF annexes are skipped with a warning).

Language resolution (§7.4.2 / §10.5.2): a selected document tagged for another
language is swapped for its same-name sibling in the offer's language when one
exists; otherwise the selected version is kept (FR fallback in practice).
"""

from __future__ import annotations

import io
import logging
import zipfile
from uuid import UUID

import httpx
from django.core.files.storage import default_storage
from pypdf import PdfReader, PdfWriter

from apps.documents.models import DocumentLibrary

logger = logging.getLogger("apps.offers.attachments")


def resolve_attached_documents(
    document_ids: list[UUID] | list[str] | None, language: str
) -> list[DocumentLibrary]:
    """Return the active documents to attach, language-resolved (FR fallback)."""
    if not document_ids:
        return []
    selected = list(DocumentLibrary.objects.filter(id__in=document_ids, is_active=True))
    resolved: dict[object, DocumentLibrary] = {}
    for doc in selected:
        target = doc
        if language and doc.language and doc.language != language and doc.file_name:
            sibling = (
                DocumentLibrary.objects.filter(
                    is_active=True, file_name=doc.file_name, language=language
                )
                .order_by("-version")
                .first()
            )
            if sibling is not None:
                target = sibling
        resolved[target.id] = target
    return sorted(resolved.values(), key=lambda d: (d.category, d.display_order))


def _read_bytes(doc: DocumentLibrary) -> bytes | None:
    if not doc.file_url or not default_storage.exists(doc.file_url):
        logger.warning("Attached document %s missing in storage (%s)", doc.id, doc.file_url)
        return None
    with default_storage.open(doc.file_url, "rb") as fh:
        return fh.read()


def _unique(name: str, used: set[str]) -> str:
    candidate, i = name, 1
    while candidate in used:
        candidate = f"{i}_{name}"
        i += 1
    used.add(candidate)
    return candidate


def bundle_zip(main_name: str, main_bytes: bytes, docs: list[DocumentLibrary]) -> bytes:
    """ZIP the main file at the root + each document under ``annexes/``."""
    buf = io.BytesIO()
    used: set[str] = set()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(main_name, main_bytes)
        used.add(main_name)
        for doc in docs:
            data = _read_bytes(doc)
            if data is None:
                continue
            name = _unique(doc.file_name or f"document-{doc.id}.bin", used)
            zf.writestr(f"annexes/{name}", data)
    return buf.getvalue()


def merge_pdfs(main_pdf: bytes, docs: list[DocumentLibrary]) -> bytes:
    """Concatenate the main PDF then each PDF annex into one document.

    Non-PDF annexes cannot be page-merged — they are skipped with a warning
    (the fixed library docs, e.g. CGV/warranty, are PDFs).
    """
    writer = PdfWriter()
    sources: list[bytes | None] = [main_pdf, *(_read_bytes(d) for d in docs)]
    for data in sources:
        if not data:
            continue
        try:
            reader = PdfReader(io.BytesIO(data))
        except Exception as exc:  # noqa: BLE001 — a bad/non-PDF annex must not fail the whole merge
            logger.warning("Skipping non-PDF / unreadable annex in merge: %s", exc)
            continue
        for page in reader.pages:
            writer.add_page(page)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def fetch_pdf(url: str, *, timeout: float = 30.0) -> bytes:
    """Fetch the Gamma export PDF (best-effort; raises on transport error)."""
    with httpx.Client(timeout=timeout, follow_redirects=True) as client:
        resp = client.get(url)
        resp.raise_for_status()
        return resp.content
