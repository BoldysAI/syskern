"""Résolution de l'indexation cuivre produit ↔ fournisseur (FEEDBACK 2).

Le poids cuivre et l'indexation étaient portés par le SKU seul. Or deux
fournisseurs du même SKU déclarent des poids différents (ex. Turquie 19 kg,
Chine 17,80 kg) : pour tarifer juste, la donnée doit suivre **la source d'achat**,
comme le PO.

Modèle retenu : les champs restent sur `Product` (valeur de référence du
catalogue) et sont **surchargeables** par `ProductSupplier`. `None` côté
fournisseur = « hérite du produit » — c'est le défaut, donc aucun lien existant
ne change de comportement tant qu'on ne saisit pas de valeur fournisseur.

Le moteur de pricing ne lit **jamais** `product.is_copper_indexed` ni
`product.copper_weight_kg_per_unit` en direct : il passe par `resolve_copper`
(cf. `ProductView.from_model`).
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True)
class CopperSpec:
    """Indexation cuivre effective d'un couple (produit, source d'achat)."""

    is_indexed: bool
    weight_kg_per_unit: Decimal | None
    #: « supplier » si au moins une valeur vient du fournisseur, sinon « product ».
    source: str

    @property
    def from_supplier(self) -> bool:
        return self.source == "supplier"


def resolve_copper(product, supplier=None) -> CopperSpec:
    """Valeurs cuivre effectives pour ce produit acheté chez ce fournisseur.

    `supplier` est le `ProductSupplier` actif de la ligne (ou None). Chaque champ
    fournisseur non nul l'emporte sur celui du produit, indépendamment de l'autre :
    un fournisseur peut ne surcharger que le poids.
    """
    sup_indexed = getattr(supplier, "is_copper_indexed", None) if supplier else None
    sup_weight = getattr(supplier, "copper_weight_kg_per_unit", None) if supplier else None

    is_indexed = sup_indexed if sup_indexed is not None else bool(product.is_copper_indexed)
    weight = sup_weight if sup_weight is not None else product.copper_weight_kg_per_unit

    source = "supplier" if (sup_indexed is not None or sup_weight is not None) else "product"
    return CopperSpec(is_indexed=bool(is_indexed), weight_kg_per_unit=weight, source=source)
