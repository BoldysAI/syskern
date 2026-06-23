"""Unit tests for incoterm chain rules (CDC §6.8.3, §12.2)."""

from __future__ import annotations

from apps.products.models import Incoterm
from apps.simulations.services.incoterm_rules import (
    check_purchase_chain_coherence,
    check_sale_chain_coherence,
    suggest_purchase_chain,
    suggest_sale_chain,
)


def test_suggest_sale_exw_empty_transports():
    chain = suggest_sale_chain(Incoterm.EXW)
    assert chain["transports"] == []
    assert chain["customs"] is None


def test_suggest_sale_cif_has_maritime():
    chain = suggest_sale_chain(Incoterm.CIF)
    assert len(chain["transports"]) == 1
    assert chain["transports"][0]["category"] == "maritime"


def test_suggest_sale_ddp_has_transport_and_customs():
    chain = suggest_sale_chain(Incoterm.DDP)
    assert len(chain["transports"]) == 1
    assert chain["customs"] == {"rate_pct": ""}


def test_suggest_purchase_fob_maritime_and_road():
    chain = suggest_purchase_chain(Incoterm.FOB)
    assert len(chain["transports"]) == 2
    assert chain["copper_variation"] == {}
    assert chain["customs"] == {"rate_pct": ""}


def test_check_sale_exw_warns_on_transport():
    sale = {"transports": [{"order": 1}], "customs": None}
    warnings = check_sale_chain_coherence(Incoterm.EXW, sale)
    assert any("EXW" in w for w in warnings)


def test_check_sale_cif_warns_without_transport():
    warnings = check_sale_chain_coherence(Incoterm.CIF, {"transports": [], "customs": None})
    assert len(warnings) == 1
    assert "CIF" in warnings[0]


def test_check_sale_ddp_warns_without_customs():
    sale = {"transports": [{"order": 1}], "customs": None}
    warnings = check_sale_chain_coherence(Incoterm.DDP, sale)
    assert any("DDP" in w and "douane" in w for w in warnings)


def test_check_purchase_exw_warns_without_transport():
    warnings = check_purchase_chain_coherence(Incoterm.EXW, {"transports": []})
    assert len(warnings) == 1


def test_check_purchase_fob_warns_without_transport():
    warnings = check_purchase_chain_coherence(Incoterm.FOB, {"transports": []})
    assert any("FOB" in w for w in warnings)


def test_check_purchase_cif_warns_on_duplicate_transport():
    purchase = {"transports": [{}, {}, {}]}
    warnings = check_purchase_chain_coherence(Incoterm.CIF, purchase)
    assert any("double" in w for w in warnings)
