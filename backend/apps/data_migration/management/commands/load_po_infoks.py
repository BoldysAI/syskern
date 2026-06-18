"""Management command: load the Infoks fiber optic cable PO file (CDC §8.4).

Usage:
    docker compose run --rm backend python manage.py load_po_infoks \\
        --file /app/migration/sources/SYMEA_FO_2026_PRICES_LIST_INFOKS.xlsx

    # Preview without writing:
    docker compose run --rm backend python manage.py load_po_infoks \\
        --file /app/migration/sources/SYMEA_FO_2026_PRICES_LIST_INFOKS.xlsx \\
        --dry-run
"""

from apps.data_migration.loaders.loader_po_infoks import INFOKSLoader

from ._loader_base import BaseLoaderCommand


class Command(BaseLoaderCommand):
    help = (
        "Load the Infoks fiber optic cable PO Excel file and enrich "
        "Product + ProductSupplier records (CDC §8.4 — Étape 2)."
    )

    loader_class = INFOKSLoader
    default_sheet = "SYMEA FO 2026"
    default_header_row = 3  # 0-based: row 4 in Excel
