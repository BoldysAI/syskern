"""Unit tests for the throwaway demo display scrubber (do not merge)."""

from __future__ import annotations

from apps.core.anonymize import EMPTY, anonymize_json, anonymize_text


def test_symea_shanghai_keeps_location():
    assert anonymize_text("Symea Shanghai") == "Shanghai"


def test_email_domain_rewritten():
    assert anonymize_text("olivier@syskern.com") == "olivier@exemple.com"


def test_engine_identifiers_kept():
    assert anonymize_text("syskern") == "syskern"
    assert anonymize_text("symea") == "symea"


def test_display_names_stripped():
    assert anonymize_text("Syskern") == EMPTY
    assert anonymize_text("SYMEA") == EMPTY
    assert anonymize_text("Unikkern") == EMPTY


def test_json_keys_intact():
    data = {
        "syskern_margin_rate": "0.20",
        "supplier_name": "Symea Shanghai",
        "brand": "unikkern",
    }
    out = anonymize_json(data)
    assert "syskern_margin_rate" in out
    assert out["syskern_margin_rate"] == "0.20"
    assert out["supplier_name"] == "Shanghai"
    assert out["brand"] == EMPTY


def test_nested_list():
    out = anonymize_json({"items": ["Syskern cable", "OK"]})
    assert out["items"][0] == "cable"
    assert out["items"][1] == "OK"


def test_empty_string_stays_empty():
    assert anonymize_text("") == ""
