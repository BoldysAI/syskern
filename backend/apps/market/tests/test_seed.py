"""Tests for the reference-data seed (CDC §3.3).

Verifies the data migrations loaded the expected rows and that the seed
helpers are idempotent (re-running creates no duplicates).
"""

from __future__ import annotations

import pytest

from apps.attributes.models import AttributeRegistry
from apps.attributes.seeds import MINIMAL_ATTRIBUTES, seed_minimal_attributes
from apps.market.models import Incoterm, TransportMode
from apps.market.seeds import (
    INCOTERMS,
    TRANSPORT_MODES,
    seed_incoterms,
    seed_transport_modes,
)

pytestmark = pytest.mark.django_db


class TestSeedPresence:
    def test_eleven_incoterms_present(self):
        for entry in INCOTERMS:
            assert Incoterm.objects.filter(code=entry["code"]).exists()
        assert Incoterm.objects.count() == 11

    def test_seven_transport_modes_present(self):
        for entry in TRANSPORT_MODES:
            assert TransportMode.objects.filter(code=entry["code"]).exists()
        assert TransportMode.objects.count() == 7

    def test_five_minimal_attributes_present(self):
        for entry in MINIMAL_ATTRIBUTES:
            assert AttributeRegistry.objects.filter(code=entry["code"]).exists()
        assert AttributeRegistry.objects.count() == 5

    def test_transport_mode_capacities(self):
        assert TransportMode.objects.get(code="20FT").default_pallet_capacity == 22
        assert TransportMode.objects.get(code="TRUCK_LCL").default_pallet_capacity is None


class TestSeedIdempotency:
    def test_reseeding_creates_no_duplicates(self):
        seed_incoterms(Incoterm)
        seed_transport_modes(TransportMode)
        seed_minimal_attributes(AttributeRegistry)
        assert Incoterm.objects.count() == 11
        assert TransportMode.objects.count() == 7
        assert AttributeRegistry.objects.count() == 5
