"""API tests for transport presets."""

from __future__ import annotations

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from apps.market.models import TransportPreset

pytestmark = pytest.mark.django_db


@pytest.fixture()
def client() -> APIClient:
    return APIClient()


class TestTransportPresetApi:
    def test_list_empty_by_default(self, client: APIClient) -> None:
        resp = client.get("/api/transport-presets/")
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["count"] == 0

    def test_create_and_list_preset(self, client: APIClient) -> None:
        resp = client.post(
            "/api/transport-presets/",
            {
                "name": "Mon fret régional",
                "transport_mode_code": "TRUCK_FULL",
                "category": "road",
                "global_cost": "1200",
                "currency": "EUR",
                "pallet_count": "28",
                "from_location": "Rotterdam",
                "to_location": "Lyon",
                "display_order": 0,
                "is_active": True,
            },
            format="json",
        )
        assert resp.status_code == status.HTTP_201_CREATED
        assert resp.data["name"] == "Mon fret régional"

        listed = client.get("/api/transport-presets/?is_active=true")
        assert listed.status_code == status.HTTP_200_OK
        assert listed.data["count"] == 1

    def test_delete_preset(self, client: APIClient) -> None:
        preset = TransportPreset.objects.create(
            name="Temporaire",
            transport_mode_code="EXPRESS",
            category="air",
            global_cost="50",
            currency="EUR",
            pallet_count="1",
            from_location="A",
            to_location="B",
            is_active=True,
        )
        resp = client.delete(f"/api/transport-presets/{preset.id}/")
        assert resp.status_code == status.HTTP_204_NO_CONTENT
        assert not TransportPreset.objects.filter(pk=preset.pk).exists()
