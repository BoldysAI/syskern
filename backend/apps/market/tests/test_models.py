"""Model and API tests for market parameters (CDC §3.2)."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from apps.market.models import MarketParameter, MarketParameterType

pytestmark = pytest.mark.django_db


@pytest.fixture()
def client() -> APIClient:
    return APIClient()


class TestCurrentMarketParameterEndpoint:
    def test_current_active_copper_parameter(self, client: APIClient) -> None:
        MarketParameter.objects.create(
            parameter_type=MarketParameterType.COPPER_PRICE,
            copper_market="LME",
            copper_price=Decimal("9500.00"),
            copper_currency="USD",
            valid_from=date(2026, 1, 1),
            is_active=False,
            source="LME",
        )
        active = MarketParameter.objects.create(
            parameter_type=MarketParameterType.COPPER_PRICE,
            copper_market="LME",
            copper_price=Decimal("9700.00"),
            copper_currency="USD",
            valid_from=date(2026, 6, 1),
            is_active=True,
            source="manual",
        )

        response = client.get(
            "/api/market-parameters/current/",
            {"parameter_type": "copper_price"},
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.data["id"] == str(active.id)
        assert response.data["copper_price"] == "9700.00"

    def test_current_active_fx_parameter(self, client: APIClient) -> None:
        MarketParameter.objects.create(
            parameter_type=MarketParameterType.FX_RATE,
            fx_from_currency="EUR",
            fx_to_currency="RMB",
            fx_rate=Decimal("7.500000"),
            valid_from=date(2026, 1, 1),
            is_active=True,
            source="BCE",
        )
        active = MarketParameter.objects.create(
            parameter_type=MarketParameterType.FX_RATE,
            fx_from_currency="EUR",
            fx_to_currency="RMB",
            fx_rate=Decimal("7.950000"),
            valid_from=date(2026, 6, 1),
            is_active=True,
            source="manual",
        )

        response = client.get(
            "/api/market-parameters/current/",
            {
                "parameter_type": "fx_rate",
                "fx_from_currency": "EUR",
                "fx_to_currency": "RMB",
            },
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.data["id"] == str(active.id)
        assert response.data["fx_rate"] == "7.950000"

    def test_current_copper_filters_by_market(self, client: APIClient) -> None:
        MarketParameter.objects.create(
            parameter_type=MarketParameterType.COPPER_PRICE,
            copper_market="LME",
            copper_price=Decimal("9500.00"),
            copper_currency="USD",
            valid_from=date(2026, 6, 1),
            is_active=True,
            source="LME",
        )
        she_active = MarketParameter.objects.create(
            parameter_type=MarketParameterType.COPPER_PRICE,
            copper_market="SHE",
            copper_price=Decimal("72000.00"),
            copper_currency="RMB",
            valid_from=date(2026, 6, 1),
            is_active=True,
            source="SHE",
        )

        response = client.get(
            "/api/market-parameters/current/",
            {"parameter_type": "copper_price", "copper_market": "SHE"},
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.data["id"] == str(she_active.id)
        assert response.data["copper_price"] == "72000.00"

    def test_current_missing_returns_404(self, client: APIClient) -> None:
        response = client.get(
            "/api/market-parameters/current/",
            {"parameter_type": "copper_price"},
        )
        assert response.status_code == status.HTTP_404_NOT_FOUND
