from __future__ import annotations

from rest_framework import viewsets
from rest_framework.decorators import api_view
from rest_framework.response import Response

from apps.products.models import Incoterm

from .models import MarketParameter, TransportMode
from .serializers import MarketParameterSerializer, TransportModeSerializer


class TransportModeViewSet(viewsets.ModelViewSet):
    queryset = TransportMode.objects.all()
    serializer_class = TransportModeSerializer
    filterset_fields = ("category", "is_active")


class MarketParameterViewSet(viewsets.ModelViewSet):
    queryset = MarketParameter.objects.all()
    serializer_class = MarketParameterSerializer
    filterset_fields = (
        "parameter_type",
        "copper_market",
        "fx_from_currency",
        "fx_to_currency",
        "is_active",
    )
    ordering = ("-valid_from",)


@api_view(["GET"])
def list_incoterms(_request):
    """Read-only listing of supported incoterms (CDC §12.2)."""
    return Response(
        {
            "incoterms": [
                {"code": code, "label": label} for code, label in Incoterm.choices
            ]
        }
    )
