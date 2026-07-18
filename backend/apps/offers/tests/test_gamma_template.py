"""Project-offer Gamma template selection + resolution (FEEDBACK 1, CDC §7.7.2)."""

from __future__ import annotations

from types import SimpleNamespace

from django.test import override_settings

from apps.offers.services.project_generator import _resolve_gamma_template

_GAMMA = {
    "TEMPLATE_ID_DEVIS_PROJET": "default-id",
    "TEMPLATES": {
        "distributeur": "distrib-id",
        "factoring": "",  # not configured yet by the client
        "export": "export-id",
    },
}


@override_settings(GAMMA=_GAMMA)
def test_resolves_configured_layout_to_its_id():
    assert _resolve_gamma_template(SimpleNamespace(gamma_template="distributeur")) == "distrib-id"
    assert _resolve_gamma_template(SimpleNamespace(gamma_template="export")) == "export-id"


@override_settings(GAMMA=_GAMMA)
def test_falls_back_to_default_when_layout_id_missing():
    # "factoring" is a valid choice but its id isn't configured yet → default.
    assert _resolve_gamma_template(SimpleNamespace(gamma_template="factoring")) == "default-id"


@override_settings(GAMMA=_GAMMA)
def test_empty_choice_uses_default_template():
    assert _resolve_gamma_template(SimpleNamespace(gamma_template="")) == "default-id"


@override_settings(GAMMA={"TEMPLATE_ID_DEVIS_PROJET": "", "TEMPLATES": {}})
def test_no_template_configured_returns_empty():
    # Nothing configured → empty (payload omits themeId, Gamma uses its default).
    assert _resolve_gamma_template(SimpleNamespace(gamma_template="distributeur")) == ""
