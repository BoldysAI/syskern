"""Management command: load the Symea Shanghai PO supplier file (CDC §8.4 — Étape 2).

Usage:
    docker compose run --rm backend python manage.py load_po_fournisseurs \\
        --file /app/migration/sources/UKN_RANGE_PRICES_MARCH_2026.xlsx

    # Preview without writing:
    docker compose run --rm backend python manage.py load_po_fournisseurs \\
        --file /app/migration/sources/UKN_RANGE_PRICES_MARCH_2026.xlsx \\
        --dry-run

    # Specific sheet (default: 'PO & SC March 2026'):
    docker compose run --rm backend python manage.py load_po_fournisseurs \\
        --file /app/migration/sources/UKN_RANGE_PRICES_MARCH_2026.xlsx \\
        --sheet "SC FRANCE 24.03.2026"
"""
from apps.data_migration.loaders.loader_po_fournisseurs import POFournisseursLoader

from ._loader_base import BaseLoaderCommand


class Command(BaseLoaderCommand):
    help = (
        "Load the Symea Shanghai PO supplier Excel file and enrich Product + "
        "ProductSupplier records (CDC §8.4 — Étape 2)."
    )

    loader_class = POFournisseursLoader
    default_sheet = "PO & SC March 2026"
    default_header_row = 12  # 0-based: row 13 in Excel
