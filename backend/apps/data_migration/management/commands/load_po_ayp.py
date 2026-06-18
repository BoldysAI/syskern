"""Management command: load the AYP CCA + LAN copper PO file (CDC §8.4).

Usage:
    docker compose run --rm backend python manage.py load_po_ayp \\
        --file /app/migration/sources/AYP_LAN_Aluminum_CCA_LAN_CU_2026.xlsx

    docker compose run --rm backend python manage.py load_po_ayp \\
        --file /app/migration/sources/AYP_LAN_Aluminum_CCA_LAN_CU_2026.xlsx \\
        --dry-run

Both sheets ``AYP CAT6 UTP CCA 2026`` and ``AYP LAN CU 2026`` are always processed.
``--sheet`` / ``--header-row`` are ignored (fixed layout).
"""

from apps.data_migration.loaders.loader_po_ayp import AYPLoader

from ._loader_base import BaseLoaderCommand


class Command(BaseLoaderCommand):
    help = (
        "Load the AYP aluminum CCA + LAN copper PO Excel file (two sheets) and "
        "enrich Product + ProductSupplier (CDC §8.4 — Étape 2)."
    )

    loader_class = AYPLoader
    default_sheet = "AYP CAT6 UTP CCA 2026"
    default_header_row = 1
