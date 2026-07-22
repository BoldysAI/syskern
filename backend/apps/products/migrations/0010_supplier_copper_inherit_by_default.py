"""Neutraliser l'indexation cuivre héritée sur les liens produit-fournisseur.

`ProductSupplier.is_copper_indexed` devient nullable (`None` = hérite du produit,
FEEDBACK 2). Jusqu'ici le champ n'était exposé nulle part dans l'UI : personne ne
l'a saisi volontairement, il était **dérivé** du cuivre produit par les loaders PO
— et 24 liens actifs portaient `False` alors que leur produit est indexé cuivre
(loaders MIRSAN/INFOKS qui ne lisent pas de cuivre et forçaient `False`).

Rendre le fournisseur autoritaire tel quel aurait donc **désindexé 24 SKU** et
changé leur PA/PV en silence. On repart de `None` partout : le moteur retombe sur
le produit, comportement strictement identique à avant. Les valeurs réellement
déclarées par un fournisseur seront (re)posées par les loaders PO — qui écrivent
désormais aussi `copper_weight_kg_per_unit` — ou saisies dans la fiche produit.
"""

from __future__ import annotations

from django.db import migrations


def inherit_copper_from_product(apps, schema_editor):
    ProductSupplier = apps.get_model("products", "ProductSupplier")
    ProductSupplier.objects.exclude(is_copper_indexed=None).update(is_copper_indexed=None)


class Migration(migrations.Migration):
    dependencies = [
        ("products", "0009_productsupplier_copper_weight_kg_per_unit_and_more"),
    ]

    operations = [
        migrations.RunPython(inherit_copper_from_product, migrations.RunPython.noop),
    ]
