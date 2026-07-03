"""Serializers for the PIM (CDC §4)."""

from __future__ import annotations

from rest_framework import serializers

from .models import Product, ProductSupplier


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
            "is_copper_indexed",
            "copper_base_price",
            "incoterm",
            "incoterm_location",
            "notes",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")


class ProductListSerializer(serializers.ModelSerializer):
    """Compact representation used in the catalog table."""

    active_supplier = serializers.SerializerMethodField()
    i18n_coverage = serializers.SerializerMethodField()

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
