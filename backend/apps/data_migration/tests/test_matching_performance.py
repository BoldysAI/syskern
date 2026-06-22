"""Performance check for ProductMatcher (CDC §8.6 acceptance).

Acceptance criterion: matching 100 Excel rows against a ~2000-product catalog
must take < 1s. The matcher pre-loads in-memory indexes once, so per-row
matching is O(1) dict lookups — this test guards against a regression to
per-row DB queries.
"""

from __future__ import annotations

import time

import pytest

from apps.data_migration.loaders.matching import ProductMatcher
from apps.data_migration.loaders.types import MatchHint
from apps.products.models import Product

pytestmark = pytest.mark.django_db


def test_match_100_rows_against_2000_products_under_1s():
    Product.objects.bulk_create(
        [Product(sku_code=f"SKU-{i:05d}", name=f"Produit {i}") for i in range(2000)]
    )

    matcher = ProductMatcher()  # one-shot index build

    # 100 hints: 50 existing SKUs (hits) + 50 unknown (misses).
    hints = [MatchHint(sku_code=f"SKU-{i:05d}") for i in range(50)]
    hints += [MatchHint(sku_code=f"MISSING-{i:05d}") for i in range(50)]

    start = time.monotonic()
    results = [matcher.match(h) for h in hints]
    elapsed = time.monotonic() - start

    assert sum(r.product_id is not None for r in results) == 50
    assert elapsed < 1.0, f"matching 100 rows took {elapsed:.3f}s (budget 1s)"
