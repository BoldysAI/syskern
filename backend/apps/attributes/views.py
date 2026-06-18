from __future__ import annotations

from django.db import transaction
from django.db.models import Count
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import AttributeRegistry, ProductAttributeValue
from .serializers import (
    AttributeRegistrySerializer,
    AttributeReorderSerializer,
    ProductAttributeValueSerializer,
)


class AttributeRegistryViewSet(viewsets.ModelViewSet):
    queryset = AttributeRegistry.objects.annotate(value_count=Count("values"))
    serializer_class = AttributeRegistrySerializer
    ordering = ("display_order", "code")
    search_fields = ("code",)
    filterset_fields = ("category", "data_type", "is_required", "is_searchable")

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
