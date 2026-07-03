"""Celery tasks for the products app.

These wrap operations that touch external services (Odoo, DeepL) or that
otherwise should not block a request thread.
"""

from __future__ import annotations

import os
from pathlib import Path

from celery import shared_task
from django.utils import timezone

from apps.odoo_sync.adapters.factory import get_odoo_adapter
from apps.offers.services.translation import DeepLClient

from .exports import build_products_xlsx
from .filters import ProductFilter
from .models import Product
from .serializers import ProductDetailSerializer

EXPORT_DIR = Path("/tmp/syskern_exports")


class _TaskError(RuntimeError):
    """Raised inside tasks to surface a clean message via Celery FAILURE."""


@shared_task(name="products.refresh_pamp_task")
def refresh_pamp_task(product_pk: str) -> dict:
    """Re-pull PAMP + stock from Odoo for a single product (read-only Odoo).

    Returns the updated `ProductDetailSerializer` payload. Raises on any
    Odoo failure so the polling endpoint surfaces the error.
    """
    try:
        product = Product.objects.get(pk=product_pk)
    except Product.DoesNotExist as e:
        raise _TaskError("Produit introuvable.") from e

    if not product.odoo_id:
        raise _TaskError("Produit non lié à Odoo — PAMP non recalculable.")

    try:
        adapter = get_odoo_adapter()
        adapter.authenticate()
        stock_map = adapter.get_stock_quantities([product.odoo_id])
    except Exception as exc:  # noqa: BLE001
        raise _TaskError(f"Odoo indisponible : {exc}") from exc

    stock = stock_map.get(product.odoo_id)
    if stock is None:
        raise _TaskError("Produit introuvable dans Odoo.")

    now = timezone.now()
    update_fields = {
        "stock_quantity": stock.quantity,
        "odoo_last_sync_at": now,
    }
    if stock.standard_price_eur is not None:
        update_fields["pamp_eur"] = stock.standard_price_eur
        update_fields["pamp_synced_at"] = now

    Product.objects.filter(pk=product.pk).update(**update_fields)
    product.refresh_from_db()
    return ProductDetailSerializer(product).data


@shared_task(name="products.export_products_task", bind=True)
def export_products_task(
    self,
    filters: dict | None = None,
    columns: list[str] | None = None,
    ids: list[str] | None = None,
) -> dict:
    """Build a filtered catalog Excel workbook and store it on disk (CDC §4.1.1).

    - `filters`: same shape as the `GET /api/products` query params.
    - `columns`: ordered list of column keys to include (default = full set).
    - `ids`: explicit product ids (export of a multi-select selection).

    Returns `{"file_url": ..., "filename": ...}` — the client polls the
    polling endpoint, then downloads the file via the URL.
    """
    qs = Product.objects.all().prefetch_related("suppliers")
    if filters:
        filterset = ProductFilter(data=filters, queryset=qs)
        qs = filterset.qs
    if ids:
        qs = qs.filter(id__in=ids)

    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    file_path = EXPORT_DIR / f"{self.request.id}.xlsx"
    file_path.write_bytes(build_products_xlsx(qs, columns=columns))

    timestamp = timezone.now().strftime("%Y%m%d_%H%M%S")
    return {
        "file_url": f"/api/products/exports/{self.request.id}/",
        "filename": f"catalog_{timestamp}.xlsx",
        "size_bytes": os.path.getsize(file_path),
    }


_FIELD_MAP = {
    "marketing": "description_marketing",
    "technical": "description_technical",
}


@shared_task(
    name="products.bulk_translate_products_task",
    bind=True,
    soft_time_limit=600,
    time_limit=660,
)
def bulk_translate_products_task(
    self,
    product_ids: list[str],
    source_lang: str = "fr",
    target_langs: list[str] | None = None,
    fields: list[str] | None = None,
) -> dict:
    """Translate several products' descriptions via DeepL + cache (CDC §10.3.2).

    Only empty target-language slots are filled (existing translations are kept).
    Reports `{current, total}` progress so the UI can show a progress bar. Aborts
    on quota / service-unavailable so the user gets a clear message.
    """
    from apps.i18n.services import translate_cached
    from apps.offers.services.translation import (
        TranslationInputError,
        TranslationQuotaError,
        TranslationUnavailableError,
    )

    source = source_lang.lower()
    targets = [lang.lower() for lang in (target_langs or ["en", "es"]) if lang.lower() != source]
    selected = [_FIELD_MAP[f] for f in (fields or ["marketing", "technical"]) if f in _FIELD_MAP]

    total = len(product_ids)
    processed = 0
    translated_fields = 0
    skipped: list[str] = []

    for pid in product_ids:
        try:
            product = Product.objects.get(pk=pid)
        except Product.DoesNotExist:
            processed += 1
            self.update_state(state="PROGRESS", meta={"current": processed, "total": total})
            continue

        changed_attrs: set[str] = set()
        for attr in selected:
            data = dict(getattr(product, attr) or {})
            source_text = (data.get(source) or "").strip()
            if not source_text:
                continue
            for lang in targets:
                if (data.get(lang) or "").strip():
                    continue  # never overwrite an existing translation
                try:
                    translated, _ = translate_cached(source_text, source, lang)
                except (TranslationQuotaError, TranslationUnavailableError) as exc:
                    # Non-recoverable for the rest of the batch — fail loudly.
                    raise _TaskError(str(exc)) from exc
                except TranslationInputError as exc:
                    skipped.append(f"{product.sku_code} ({attr}/{lang}) : {exc}")
                    continue
                if translated:
                    data[lang] = translated
                    changed_attrs.add(attr)
                    translated_fields += 1
            setattr(product, attr, data)

        if changed_attrs:
            product.save(update_fields=[*changed_attrs, "updated_at"])

        processed += 1
        self.update_state(state="PROGRESS", meta={"current": processed, "total": total})

    return {
        "product_count": total,
        "processed": processed,
        "translated_fields": translated_fields,
        "skipped": skipped[:50],
    }


@shared_task(name="products.translate_product_task")
def translate_product_task(product_pk: str, target_lang: str) -> dict:
    """Translate the FR descriptions to EN/ES via DeepL and cache them.

    Returns the updated `ProductDetailSerializer` payload. Raises on DeepL
    failure (missing key, quota, network) — Celery FAILURE surfaces the
    message to the polling endpoint.
    """
    target = target_lang.lower()
    if target not in {"en", "es"}:
        raise _TaskError("Langue cible invalide (attendu : en ou es).")

    try:
        product = Product.objects.get(pk=product_pk)
    except Product.DoesNotExist as e:
        raise _TaskError("Produit introuvable.") from e

    marketing_fr = (product.description_marketing or {}).get("fr", "")
    technical_fr = (product.description_technical or {}).get("fr", "")
    if not marketing_fr and not technical_fr:
        raise _TaskError("Aucune description française à traduire.")

    client = DeepLClient()
    marketing_tr = (
        client.translate(source_text=marketing_fr, source_lang="fr", target_lang=target)
        if marketing_fr
        else ""
    )
    technical_tr = (
        client.translate(source_text=technical_fr, source_lang="fr", target_lang=target)
        if technical_fr
        else ""
    )

    marketing = dict(product.description_marketing or {})
    technical = dict(product.description_technical or {})
    if marketing_tr:
        marketing[target] = marketing_tr
    if technical_tr:
        technical[target] = technical_tr
    product.description_marketing = marketing
    product.description_technical = technical
    product.save(update_fields=["description_marketing", "description_technical", "updated_at"])
    return ProductDetailSerializer(product).data
