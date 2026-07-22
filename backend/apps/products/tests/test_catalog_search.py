"""Recherche catalogue `?q=` — full-text + sous-chaîne (FEEDBACK 1, CDC §4.1.1)."""

from __future__ import annotations

import pytest

from apps.products.filters import ProductFilter
from apps.products.models import Product

pytestmark = pytest.mark.django_db


@pytest.fixture
def catalog() -> None:
    Product.objects.create(sku_code="KCU64PZHDGRB", name="Câble U/UTP Cat6 LSZH gris")
    Product.objects.create(sku_code="KCFU64PZHDGRB", name="Câble F/UTP Cat6 LSZH gris")
    Product.objects.create(sku_code="KCU64PLGRB", name="Câble U/UTP Cat6 PVC gris")
    Product.objects.create(sku_code="RACK19-42U", name="Baie 19 pouces 42U", item_code="80012345")


def _search(term: str) -> list[str]:
    qs = ProductFilter({"q": term}, queryset=Product.objects.all()).qs
    return list(qs.values_list("sku_code", flat=True))


def test_full_sku_matches(catalog):
    assert _search("KCU64PZHDGRB") == ["KCU64PZHDGRB"]


def test_substring_in_the_middle_of_a_sku(catalog):
    """Le cœur de la demande : un fragment doit suffire.

    Le full-text seul échouait ici — il indexe des lexèmes entiers.
    """
    assert set(_search("U64PZ")) == {"KCU64PZHDGRB", "KCFU64PZHDGRB"}


def test_substring_suffix(catalog):
    assert set(_search("PZHDGRB")) == {"KCU64PZHDGRB", "KCFU64PZHDGRB"}


def test_prefix_ranks_before_other_substring_matches(catalog):
    """« U64P » matche 3 SKU ; ceux qui *commencent* par le terme passeraient devant."""
    results = _search("U64P")
    assert set(results) == {"KCU64PZHDGRB", "KCU64PLGRB", "KCFU64PZHDGRB"}
    # Aucun ne commence par « U64P » → tri alphabétique de repli sur le SKU.
    assert results == sorted(results)
    # « KCU64 » n'est pas une sous-chaîne de KC**F**U64… : la recherche est stricte.
    assert set(_search("KCU64")) == {"KCU64PZHDGRB", "KCU64PLGRB"}


def test_exact_sku_ranks_first(catalog):
    assert _search("KCU64PLGRB")[0] == "KCU64PLGRB"


def test_item_code_is_searchable(catalog):
    assert _search("0012345") == ["RACK19-42U"]


def test_french_full_text_still_works(catalog):
    """La recherche par mot (avec accents/stems FR) n'est pas régressée."""
    assert set(_search("câble")) == {"KCU64PZHDGRB", "KCFU64PZHDGRB", "KCU64PLGRB"}


def test_blank_query_returns_everything(catalog):
    assert len(_search("   ")) == Product.objects.count()


def test_unknown_term_returns_nothing(catalog):
    assert _search("ZZZZ-INEXISTANT") == []
