"""Serializers for the Fournisseurs module (Épic FEEDBACK 1 — écart CDC §11.3)."""

from __future__ import annotations

from rest_framework import serializers

from apps.products.models import Incoterm, ProductSupplier, SupplierPriceHistory

from .models import Supplier


class SupplierListSerializer(serializers.ModelSerializer):
    """Compact row for the suppliers table. `linked_skus_count` is annotated
    on the queryset so it stays O(1)."""

    linked_skus_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Supplier
        fields = (
            "id",
            "name",
            "code",
            "currency_default",
            "incoterm_default",
            "factory_code_default",
            "location",
            "is_active",
            "linked_skus_count",
            "updated_at",
        )


class SupplierDetailSerializer(serializers.ModelSerializer):
    linked_skus_count = serializers.SerializerMethodField()

    class Meta:
        model = Supplier
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")

    def get_linked_skus_count(self, obj: Supplier) -> int:
        count = getattr(obj, "linked_skus_count", None)
        if count is not None:
            return count
        return obj.product_links.count()


class SupplierWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Supplier
        exclude = ("created_at", "updated_at")
        read_only_fields = ("id",)

    def validate_incoterm_default(self, value: str) -> str:
        if value and value not in Incoterm.values:
            raise serializers.ValidationError("Incoterm inconnu.")
        return value


class SupplierSkuLinkInputSerializer(serializers.Serializer):
    """Body for `POST /api/suppliers/{id}/skus/` — link an existing SKU."""

    sku = serializers.CharField(required=False, allow_blank=True)
    product_id = serializers.UUIDField(required=False)

    def validate(self, attrs: dict) -> dict:
        if not attrs.get("sku") and not attrs.get("product_id"):
            raise serializers.ValidationError("Fournis un « sku » ou un « product_id ».")
        return attrs


class SupplierBulkPoSerializer(serializers.Serializer):
    """Body for `POST /api/suppliers/{id}/skus/bulk-po/` — batch PO update wizard.

    Target selection by `link_ids` (ProductSupplier rows) **or** `product_ids`
    (resolved to this supplier's links) — the catalog picker selects products.
    `mode`: `set` (fixed value), `pct` (signed % adjustment), `abs` (signed amount).
    A negative `value` decreases (pct/abs).
    """

    link_ids = serializers.ListField(
        child=serializers.UUIDField(), required=False, default=list, max_length=5000
    )
    product_ids = serializers.ListField(
        child=serializers.UUIDField(), required=False, default=list, max_length=5000
    )
    mode = serializers.ChoiceField(choices=["set", "pct", "abs"])
    value = serializers.DecimalField(max_digits=12, decimal_places=4)

    def validate(self, attrs: dict) -> dict:
        if not attrs.get("link_ids") and not attrs.get("product_ids"):
            raise serializers.ValidationError("Fournis « link_ids » ou « product_ids ».")
        if attrs["mode"] == "set" and attrs["value"] < 0:
            raise serializers.ValidationError({"value": "Le PO ne peut pas être négatif."})
        return attrs


class SupplierBulkLinkSerializer(serializers.Serializer):
    """Body for `POST /api/suppliers/{id}/skus/bulk-link/` — link several SKUs at once."""

    product_ids = serializers.ListField(
        child=serializers.UUIDField(), allow_empty=False, max_length=5000
    )


class SupplierProductLinkSerializer(serializers.ModelSerializer):
    """A `ProductSupplier` row seen from the supplier side (SKU-centric)."""

    product_sku = serializers.CharField(source="product.sku_code", read_only=True)
    product_name = serializers.CharField(source="product.name", read_only=True)
    product_designation = serializers.CharField(source="product.designation", read_only=True)

    class Meta:
        model = ProductSupplier
        fields = (
            "id",
            "product",
            "product_sku",
            "product_name",
            "product_designation",
            "supplier",
            "supplier_name",
            "factory_code",
            "is_active",
            "po_base_price",
            "po_currency",
            "incoterm",
            "incoterm_location",
            "updated_at",
        )
        read_only_fields = fields


class SupplierPriceHistorySerializer(serializers.ModelSerializer):
    product_sku = serializers.CharField(source="product_supplier.product.sku_code", read_only=True)
    supplier_name = serializers.CharField(source="product_supplier.supplier_name", read_only=True)

    class Meta:
        model = SupplierPriceHistory
        fields = (
            "id",
            "product_supplier",
            "product_sku",
            "supplier_name",
            "old_po_base_price",
            "new_po_base_price",
            "po_currency",
            "source",
            "created_at",
        )
        read_only_fields = fields
