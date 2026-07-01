"""Tests for user-facing engine error messages."""

from __future__ import annotations

from apps.simulations.services.engine.errors import (
    humanize_engine_error,
    missing_fx_rate_message,
)


def test_missing_fx_rate_message_usd() -> None:
    msg = missing_fx_rate_message("fx_eur_usd")
    assert "EUR → USD" in msg
    assert "paramètres marché" in msg
    assert "fx_eur_usd" not in msg


def test_humanize_engine_error_legacy_english_fx() -> None:
    raw = "Missing FX rate `fx_eur_usd` in market parameters."
    msg = humanize_engine_error(ValueError(raw))
    assert msg == missing_fx_rate_message("fx_eur_usd")


def test_humanize_engine_error_french_passthrough() -> None:
    fr = "Produit ABC : aucun fournisseur actif — calcul impossible."
    assert humanize_engine_error(ValueError(fr)) == fr


def test_humanize_engine_error_unknown_technical() -> None:
    msg = humanize_engine_error(RuntimeError("KeyError: 'foo'"))
    assert "KeyError" not in msg
    assert "paramètres de la simulation" in msg
