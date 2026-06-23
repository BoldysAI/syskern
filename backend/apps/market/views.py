from __future__ import annotations

from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view
from rest_framework.response import Response

from .models import Incoterm, MarketParameter, MarketParameterType, TransportMode
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

    @action(detail=False, methods=["get"], url_path="current")
    def current(self, request):
        """Return the active market parameter for the requested type (CDC §3.2)."""
        parameter_type = request.query_params.get("parameter_type")
        if parameter_type not in MarketParameterType.values:
            return Response(
                {"detail": "parameter_type requis : copper_price ou fx_rate."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        qs = MarketParameter.objects.filter(
            is_active=True,
            parameter_type=parameter_type,
        )
        if parameter_type == MarketParameterType.FX_RATE:
            fx_from = request.query_params.get("fx_from_currency")
            fx_to = request.query_params.get("fx_to_currency")
            if not fx_from or not fx_to:
                return Response(
                    {
                        "detail": (
                            "fx_from_currency et fx_to_currency requis pour fx_rate."
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            qs = qs.filter(fx_from_currency=fx_from, fx_to_currency=fx_to)

        param = qs.order_by("-valid_from").first()
        if param is None:
            return Response(
                {"detail": "Aucun paramètre actif trouvé."},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(MarketParameterSerializer(param).data)


@api_view(["GET"])
def list_incoterms(_request):
    """Read-only listing of supported incoterms (CDC §12.2).

    Reads the seeded `incoterms` reference table (CDC §3.3).
    """
    return Response(
        {
            "incoterms": [
                {"code": it.code, "label": it.label}
                for it in Incoterm.objects.filter(is_active=True)
            ]
        }
    )
