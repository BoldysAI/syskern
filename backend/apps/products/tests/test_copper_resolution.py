"""Résolution de l'indexation cuivre produit ↔ fournisseur (FEEDBACK 2)."""

from __future__ import annotations

from decimal import Decimal

import pytest

from apps.products.models import Product, ProductSupplier
from apps.products.services.copper import resolve_copper

pytestmark = pytest.mark.django_db


def _product(**kwargs) -> Product:
    defaults = {
        "sku_code": "CU-1",
        "name": "Câble cuivre",
        "is_copper_indexed": True,
        "copper_weight_kg_per_unit": Decimal("17.80"),
    }
    return Product.objects.create(**{**defaults, **kwargs})


def _link(product: Product, **kwargs) -> ProductSupplier:
    defaults = {"supplier_name": "SYMEA LIMITED", "po_base_price": Decimal("100")}
    return ProductSupplier.objects.create(product=product, **{**defaults, **kwargs})


def test_no_supplier_falls_back_to_product():
    spec = resolve_copper(_product(), None)
    assert spec.is_indexed is True
    assert spec.weight_kg_per_unit == Decimal("17.80")
    assert spec.source == "product"


def test_supplier_without_override_inherits():
    """Le défaut d'un lien (tout à NULL) ne change rien au comportement."""
    product = _product()
    spec = resolve_copper(product, _link(product))
    assert spec.is_indexed is True
    assert spec.weight_kg_per_unit == Decimal("17.80")
    assert spec.source == "product"


def test_supplier_weight_wins():
    """Le cas Olivier : Turquie annonce 19 kg là où le produit dit 17,80."""
    product = _product()
    link = _link(product, supplier_name="MIRSAN", copper_weight_kg_per_unit=Decimal("19"))
    spec = resolve_copper(product, link)
    assert spec.weight_kg_per_unit == Decimal("19")
    assert spec.is_indexed is True
    assert spec.source == "supplier"
    assert spec.from_supplier


def test_two_suppliers_of_same_sku_resolve_differently():
    product = _product()
    turquie = _link(product, supplier_name="MIRSAN", copper_weight_kg_per_unit=Decimal("19"))
    chine = _link(product, supplier_name="HONTO")
    assert resolve_copper(product, turquie).weight_kg_per_unit == Decimal("19")
    assert resolve_copper(product, chine).weight_kg_per_unit == Decimal("17.80")


def test_supplier_can_force_not_indexed():
    product = _product()
    spec = resolve_copper(product, _link(product, is_copper_indexed=False))
    assert spec.is_indexed is False
    assert spec.source == "supplier"


def test_supplier_can_index_a_product_that_is_not():
    product = _product(is_copper_indexed=False, copper_weight_kg_per_unit=None)
    link = _link(product, is_copper_indexed=True, copper_weight_kg_per_unit=Decimal("12.5"))
    spec = resolve_copper(product, link)
    assert spec.is_indexed is True
    assert spec.weight_kg_per_unit == Decimal("12.5")


def test_weight_override_alone_keeps_product_indexation():
    """Les deux champs sont indépendants : surcharger le poids seul suffit."""
    product = _product()
    spec = resolve_copper(product, _link(product, copper_weight_kg_per_unit=Decimal("21")))
    assert spec.is_indexed is True
    assert spec.weight_kg_per_unit == Decimal("21")


def test_engine_product_view_uses_supplier_weight():
    """Le moteur voit le poids du fournisseur, pas celui du catalogue."""
    from apps.simulations.services.engine.context import ProductView

    product = _product()
    turquie = _link(product, supplier_name="MIRSAN", copper_weight_kg_per_unit=Decimal("19"))
    assert ProductView.from_model(product, turquie).copper_weight_kg_per_unit == Decimal("19")
    # Sans fournisseur (ou fournisseur neutre) → valeur catalogue, inchangée.
    assert ProductView.from_model(product).copper_weight_kg_per_unit == Decimal("17.80")


def test_supplier_indexation_drives_fx_preflight():
    """Un fournisseur indexé cuivre impose le taux RMB même si le produit ne l'est pas."""
    from apps.simulations.services.engine.validation import collect_line_fx_currencies

    product = _product(is_copper_indexed=False, copper_weight_kg_per_unit=None)
    link = _link(product, is_copper_indexed=True, copper_weight_kg_per_unit=Decimal("12.5"))
    purchase_config = {"copper_variation": {}, "currency_conversion": {"to_currency": "EUR"}}
    needed = collect_line_fx_currencies(
        product=product,
        po_currency="EUR",
        purchase_config=purchase_config,
        sale_config={},
        supplier=link,
    )
    assert "RMB" in needed
    # Sans la surcharge fournisseur, le produit non indexé n'exige pas le RMB.
    assert "RMB" not in collect_line_fx_currencies(
        product=product,
        po_currency="EUR",
        purchase_config=purchase_config,
        sale_config={},
    )


def test_serializer_exposes_effective_copper(client, django_user_model):
    from apps.products.serializers import ProductSupplierSerializer

    product = _product()
    link = _link(product, copper_weight_kg_per_unit=Decimal("19"))
    link.refresh_from_db()  # quantification DB (4 décimales), comme en lecture API
    data = ProductSupplierSerializer(link).data
    assert data["effective_copper"] == {
        "is_copper_indexed": True,
        "copper_weight_kg_per_unit": "19.0000",
        "source": "supplier",
    }
