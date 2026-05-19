"""Management command: load the technical GTIN/packing attributes Excel file (CDC §8.4).

Usage:
    docker compose run --rm backend python manage.py load_technique \\
        --file /app/migration/sources/UKN_all_items_list_GTIN_packing.xlsx

    # Preview without writing:
    docker compose run --rm backend python manage.py load_technique \\
        --file /app/migration/sources/UKN_all_items_list_GTIN_packing.xlsx \\
        --dry-run

All 3 brand sheets (UKN, NEXKERN, ORSEAN) are always processed.
``--sheet`` / ``--header-row`` are ignored (fixed multi-sheet strategy).

Requires the attributes app schema (EAV). On a fresh database, run migrate first::

    docker compose run --rm backend python manage.py migrate
"""
from apps.data_migration.loaders.loader_technique import TechniqueLoader

from ._loader_base import BaseLoaderCommand


class Command(BaseLoaderCommand):
    help = (
        "Load the technical / GTIN / packing attributes Excel file and enrich "
        "Product records + EAV (cpr_level, od_mm, uid_code) across 3 brand sheets "
        "(CDC §8.4 — Étape 2)."
    )

    loader_class = TechniqueLoader
    default_sheet = "GTIN code & packing details"
    default_header_row = 0
