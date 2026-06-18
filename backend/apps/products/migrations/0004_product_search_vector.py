"""Full-text search vector for the catalog (CDC §4.1.1).

Adds a Postgres `tsvector` column `search_vector` combining the `french`
dictionary (FR free text) and `simple` dictionary (codes, EN/ES) with
weighted `setweight`, kept up to date by a BEFORE INSERT/UPDATE trigger
(the ORM writes NULL, the trigger recomputes from the row), plus a GIN index.

A trigger (rather than a GENERATED column) is used so the Django ORM can
keep listing the field as a concrete column without hitting "cannot insert a
non-DEFAULT value into a generated column". Django ORM state is kept in sync
via SeparateDatabaseAndState.
"""

from __future__ import annotations

import django.contrib.postgres.indexes
import django.contrib.postgres.search
from django.db import migrations


# Shared tsvector expression — referenced by both the trigger (NEW.*) and the
# one-off backfill (bare columns).
def _vector_expr(prefix: str) -> str:
    return (
        f"setweight(to_tsvector('simple', coalesce({prefix}sku_code, '')), 'A') || "
        f"setweight(to_tsvector('simple', coalesce({prefix}parent_reference, '')), 'A') || "
        f"setweight(to_tsvector('french', coalesce({prefix}name, '')), 'B') || "
        f"setweight(to_tsvector('french', coalesce({prefix}description_marketing ->> 'fr', '')), 'C') || "
        f"setweight(to_tsvector('french', coalesce({prefix}description_technical ->> 'fr', '')), 'C') || "
        f"setweight(to_tsvector('simple', coalesce({prefix}description_marketing ->> 'en', '')), 'D') || "
        f"setweight(to_tsvector('simple', coalesce({prefix}description_marketing ->> 'es', '')), 'D')"
    )


_FORWARD = f"""
ALTER TABLE products ADD COLUMN search_vector tsvector;

CREATE FUNCTION products_search_vector_update() RETURNS trigger AS $$
BEGIN
    NEW.search_vector := {_vector_expr("NEW.")};
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER products_search_vector_trigger
BEFORE INSERT OR UPDATE ON products
FOR EACH ROW EXECUTE FUNCTION products_search_vector_update();

UPDATE products SET search_vector = {_vector_expr("")};

CREATE INDEX idx_products_search_vector ON products USING GIN (search_vector);
"""

_REVERSE = """
DROP INDEX IF EXISTS idx_products_search_vector;
DROP TRIGGER IF EXISTS products_search_vector_trigger ON products;
DROP FUNCTION IF EXISTS products_search_vector_update();
ALTER TABLE products DROP COLUMN IF EXISTS search_vector;
"""


class Migration(migrations.Migration):
    dependencies = [
        ("products", "0003_product_odoo_sync_error_product_odoo_sync_status"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunSQL(sql=_FORWARD, reverse_sql=_REVERSE),
            ],
            state_operations=[
                migrations.AddField(
                    model_name="product",
                    name="search_vector",
                    field=django.contrib.postgres.search.SearchVectorField(
                        editable=False, null=True
                    ),
                ),
                migrations.AddIndex(
                    model_name="product",
                    index=django.contrib.postgres.indexes.GinIndex(
                        fields=["search_vector"], name="idx_products_search_vector"
                    ),
                ),
            ],
        ),
    ]
