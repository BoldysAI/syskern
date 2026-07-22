"""Serializers for the PIM (CDC §4)."""

from __future__ import annotations

from django.db import transaction
from rest_framework import serializers

from .models import Product, ProductSupplier
from .services.copper import resolve_copper


class BulkLookupSerializer(serializers.Serializer):
    """Body for `POST /api/products/lookup-bulk` (CDC §6.9.2)."""

    skus = serializers.ListField(
        child=serializers.CharField(allow_blank=True),
        allow_empty=False,
        max_length=10000,
    )


_LANG_CHOICES = ["fr", "en", "es"]
_CONTENT_FIELD_CHOICES = ["marketing", "technical"]


class BulkTranslateSerializer(serializers.Serializer):
    """Body for `POST /api/products/bulk-translate` (CDC §10.3.2)."""

    ids = serializers.ListField(child=serializers.UUIDField(), allow_empty=False, max_length=1000)
    source_lang = serializers.ChoiceField(choices=_LANG_CHOICES, default="fr")
    target_langs = serializers.ListField(
        child=serializers.ChoiceField(choices=_LANG_CHOICES), allow_empty=False
    )
    content_fields = serializers.ListField(
        child=serializers.ChoiceField(choices=_CONTENT_FIELD_CHOICES), required=False
    )

    def validate(self, attrs: dict) -> dict:
        targets = [lang for lang in attrs["target_langs"] if lang != attrs["source_lang"]]
        if not targets:
            raise serializers.ValidationError(
                "Au moins une langue cible différente de la source est requise."
            )
        attrs["target_langs"] = targets
        return attrs


class ProductSupplierSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductSupplier
        fields = (
            "id",
            "product",
            "supplier_name",
            "factory_code",
            "is_active",
            "po_base_price",
            "po_currency",
            # `null` sur ces deux champs = « hérite du produit » (FEEDBACK 2).
            "is_copper_indexed",
            "copper_weight_kg_per_unit",
            "copper_base_price",
            "incoterm",
            "incoterm_location",
            "notes",
            "created_at",
            "updated_at",
            "effective_copper",
        )
        read_only_fields = ("id", "created_at", "updated_at", "effective_copper")

    effective_copper = serializers.SerializerMethodField()

    def get_effective_copper(self, obj) -> dict:
        """Valeurs cuivre réellement appliquées si cette source est active.

        Évite au front de rejouer la règle d'héritage produit ↔ fournisseur.
        """
        spec = resolve_copper(obj.product, obj)
        return {
            "is_copper_indexed": spec.is_indexed,
            "copper_weight_kg_per_unit": (
                str(spec.weight_kg_per_unit) if spec.weight_kg_per_unit is not None else None
            ),
            "source": spec.source,
        }

    @staticmethod
    def _activate_exclusive(instance: ProductSupplier) -> None:
        """Ensure only this supplier is active for its product (mutex index)."""
        with transaction.atomic():
            ProductSupplier.objects.filter(product=instance.product).exclude(pk=instance.pk).update(
                is_active=False
            )
            if not instance.is_active:
                instance.is_active = True
                instance.save(update_fields=["is_active", "updated_at"])

    @staticmethod
    def _resolve_supplier_entity(validated_data: dict) -> None:
        """Attach the `Supplier` entity by name when one already exists.

        Keeps the FK populated for links created/edited from the product side
        (module Fournisseurs). Never *creates* an entity here — the canonical
        CRUD is `/api/suppliers/` — so free-text typos don't spawn duplicates.
        """
        if validated_data.get("supplier"):
            return
        name = (validated_data.get("supplier_name") or "").strip()
        if not name:
            return
        from apps.suppliers.models import Supplier

        match = Supplier.objects.filter(name__iexact=name).first()
        if match is not None:
            validated_data["supplier"] = match

    def create(self, validated_data: dict) -> ProductSupplier:
        self._resolve_supplier_entity(validated_data)
        if validated_data.get("is_active"):
            with transaction.atomic():
                ProductSupplier.objects.filter(product=validated_data["product"]).update(
                    is_active=False
                )
                return ProductSupplier.objects.create(**validated_data)
        return ProductSupplier.objects.create(**validated_data)

    def update(self, instance: ProductSupplier, validated_data: dict) -> ProductSupplier:
        wants_active = validated_data.pop("is_active", None)
        old_po = instance.po_base_price
        self._resolve_supplier_entity(validated_data)

        for attr, value in validated_data.items():
            setattr(instance, attr, value)

        if wants_active is True:
            self._activate_exclusive(instance)
        elif wants_active is False:
            instance.is_active = False
            instance.save()
        else:
            instance.save()

        # Trail manual PO base price edits (module Fournisseurs, source=manual).
        if "po_base_price" in validated_data and instance.po_base_price != old_po:
            from apps.suppliers.services import record_po_change

            from .models import PriceChangeSource

            record_po_change(
                instance,
                old_price=old_po,
                new_price=instance.po_base_price,
                source=PriceChangeSource.MANUAL,
            )

        return instance


class ProductListSerializer(serializers.ModelSerializer):
    """Compact representation used in the catalog table."""

    active_supplier = serializers.SerializerMethodField()
    i18n_coverage = serializers.SerializerMethodField()
    attribute_values = serializers.SerializerMethodField()
    catalog_pv = serializers.SerializerMethodField()
    completeness_pct = serializers.SerializerMethodField()

    class Meta:
        model = Product
        fields = (
            "id",
            "sku_code",
            "name",
            "brand",
            "universe",
            "family",
            "range",
            "sub_range",
            "is_copper_indexed",
            "stock_quantity",
            "pamp_eur",
            "is_active",
            "active_supplier",
            "i18n_coverage",
            "attribute_values",
            "catalog_pv",
            "completeness_pct",
            "updated_at",
        )

    def get_active_supplier(self, obj: Product) -> str:
        # The list view prefetches `suppliers`, so this is O(1) memory access.
        for s in obj.suppliers.all():
            if s.is_active:
                return s.supplier_name
        return ""

    def get_i18n_coverage(self, obj: Product) -> dict:
        return obj.i18n_coverage

    def get_attribute_values(self, obj: Product) -> dict[str, object]:
        codes: list[str] = self.context.get("attr_columns") or []
        if not codes:
            return {}
        code_set = set(codes)
        result: dict[str, object] = {}
        for pav in obj.attribute_values.all():
            code = pav.attribute.code
            if code in code_set:
                result[code] = pav.value
        return result

    def get_catalog_pv(self, obj: Product) -> dict | None:
        return self.context.get("catalog_pv_map", {}).get(str(obj.id))

    def get_completeness_pct(self, obj: Product) -> float | None:
        return self.context.get("completeness_map", {}).get(str(obj.id))


class ProductDetailSerializer(serializers.ModelSerializer):
    """Full product payload used by the detail view."""

    suppliers = ProductSupplierSerializer(many=True, read_only=True)
    i18n_coverage = serializers.SerializerMethodField()

    class Meta:
        model = Product
        fields = "__all__"
        read_only_fields = (
            "id",
            "created_at",
            "updated_at",
            "odoo_last_sync_at",
            "pamp_synced_at",
        )

    def get_i18n_coverage(self, obj: Product) -> dict:
        return obj.i18n_coverage


class ProductWriteSerializer(serializers.ModelSerializer):
    """Used for create/update — does not embed suppliers (managed
    separately via the nested router)."""

    class Meta:
        model = Product
        exclude = ("created_at", "updated_at", "odoo_last_sync_at", "pamp_synced_at")
        read_only_fields = ("id",)

    def validate(self, attrs: dict) -> dict:
        """Cross-field rules from CDC §4.5."""
        is_copper = attrs.get(
            "is_copper_indexed", getattr(self.instance, "is_copper_indexed", False)
        )
        copper_weight = attrs.get(
            "copper_weight_kg_per_unit",
            getattr(self.instance, "copper_weight_kg_per_unit", None),
        )
        if is_copper and (copper_weight is None or copper_weight <= 0):
            raise serializers.ValidationError(
                {"copper_weight_kg_per_unit": "Required and > 0 when is_copper_indexed is true."}
            )

        marketing = attrs.get(
            "description_marketing",
            getattr(self.instance, "description_marketing", {}) or {},
        )
        if not (isinstance(marketing, dict) and marketing.get("fr")):
            raise serializers.ValidationError(
                {"description_marketing": "French description (`fr`) is required."}
            )
        return attrs
