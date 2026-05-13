from __future__ import annotations

from rest_framework import viewsets

from .models import Client
from .serializers import ClientSerializer


class ClientViewSet(viewsets.ModelViewSet):
    queryset = Client.objects.all()
    serializer_class = ClientSerializer
    filterset_fields = (
        "is_prospect",
        "preferred_currency",
        "preferred_language",
        "segment",
        "address_country",
    )
    search_fields = ("name", "email", "address_city", "address_country")
    ordering_fields = ("name", "created_at", "updated_at")
    ordering = ("name",)
