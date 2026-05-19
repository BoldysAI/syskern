"""Management command: load the Mirsan racks & infrastructure PO file (CDC §8.4).

Usage:
    docker compose run --rm backend python manage.py load_po_mirsan \\
        --file /app/migration/sources/MIRSAN_PRICES_LIST_2025_2026.xlsx

    # Preview without writing:
    docker compose run --rm backend python manage.py load_po_mirsan \\
        --file /app/migration/sources/MIRSAN_PRICES_LIST_2025_2026.xlsx \\
        --dry-run

All 4 relevant sheets are processed automatically (START CABINETS, GRID CABINETS,
RACKS & OPEN RACKS, ACCESSORIES 19).  The --sheet and --header-row flags are
ignored for this loader (multi-sheet strategy).
"""
from apps.data_migration.loaders.loader_po_mirsan import MirsanLoader

from ._loader_base import BaseLoaderCommand


class Command(BaseLoaderCommand):
    help = (
        "Load the Mirsan racks & infrastructure PO Excel file and enrich "
        "Product + ProductSupplier records across 4 sheets (CDC §8.4)."
    )

    loader_class = MirsanLoader
    default_sheet = "START CABINETS"  # informational only — loader overrides run()
    default_header_row = 5
