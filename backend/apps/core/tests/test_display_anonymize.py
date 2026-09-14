"""Unit tests for the throwaway demo display scrubber (do not merge)."""

from __future__ import annotations

from apps.core.anonymize import (
    EMPTY,
    anonymize_json,
    anonymize_text,
    rewrite_schema_keys,
    spectacular_postprocess,
)


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


def test_schema_keys_rewritten_for_swagger():
    schema = {
        "components": {
            "schemas": {
                "Simulation": {
                    "properties": {
                        "symea_margin_rate": {"type": "string"},
                        "syskern_margin_rate": {"type": "string"},
                    },
                    "required": ["symea_margin_rate", "syskern_margin_rate"],
                }
            }
        }
    }
    out = rewrite_schema_keys(schema)
    props = out["components"]["schemas"]["Simulation"]["properties"]
    assert "purchase_margin_rate" in props
    assert "sale_margin_rate" in props
    assert "symea_margin_rate" not in props
    assert out["components"]["schemas"]["Simulation"]["required"] == [
        "purchase_margin_rate",
        "sale_margin_rate",
    ]


def test_spectacular_hook_scrubs_descriptions():
    result = spectacular_postprocess(
        {"info": {"title": "Syskern Pricing API", "description": "Symea backend"}},
        generator=object(),
        request=object(),
        public=True,
    )
    assert "Syskern" not in result["info"]["title"]
    assert "Symea" not in result["info"]["description"]
    assert result["info"]["title"] == "Pricing API"
