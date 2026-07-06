from __future__ import annotations

from django.db import transaction
from django.db.models import Count
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.products.models import Product

from .models import AttributeRegistry, ProductAttributeValue
from .serializers import (
    AttributeRegistrySerializer,
    AttributeReorderSerializer,
    ProductAttributeValueSerializer,
)
from .services.backfill import backfill_attribute_defaults
from .tasks import backfill_attribute_defaults_task

_SYNC_BACKFILL_PRODUCT_THRESHOLD = 100


class AttributeRegistryViewSet(viewsets.ModelViewSet):
    queryset = AttributeRegistry.objects.annotate(value_count=Count("values"))
    serializer_class = AttributeRegistrySerializer
    ordering = ("display_order", "code")
    search_fields = ("code",)
    filterset_fields = ("category", "data_type", "is_required", "is_searchable", "is_filterable")

    def perform_create(self, serializer) -> None:
        instance = serializer.save()
        if instance.default_value is None:
            return
        product_count = Product.objects.count()
        if product_count <= _SYNC_BACKFILL_PRODUCT_THRESHOLD:
            backfill_attribute_defaults(instance.pk)
        else:
            backfill_attribute_defaults_task.delay(str(instance.pk))

    @action(detail=False, methods=["post"])
    def reorder(self, request):
        """Body: `{"ids": [uuid, uuid, ...]}` — display_order set by position."""
        ser = AttributeReorderSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        ids = ser.validated_data["ids"]
        with transaction.atomic():
            for idx, attr_id in enumerate(ids):
                AttributeRegistry.objects.filter(pk=attr_id).update(display_order=idx)
        return Response({"reordered": len(ids)}, status=status.HTTP_200_OK)


class ProductAttributeValueViewSet(viewsets.ModelViewSet):
    queryset = ProductAttributeValue.objects.select_related("attribute", "product").all()
    serializer_class = ProductAttributeValueSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        product_id = self.request.query_params.get("product")
        if product_id:
            qs = qs.filter(product_id=product_id)
        return qs
