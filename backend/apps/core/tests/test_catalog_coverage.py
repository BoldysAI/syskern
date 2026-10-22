"""French catalog keys must have an English entry (story 7.4).

There is no CI pipeline in the repo. ``pytest`` is the local gate: a French key
without English fails here. ``_proof.only_fr`` stays untranslated on purpose.
"""

from __future__ import annotations

import re
from pathlib import Path

from apps.accounts.ui_locale import EN, FR

_REPO = Path(__file__).resolve().parents[4]
_CATALOGS = _REPO / "frontend" / "src" / "lib" / "i18n" / "catalogs"
_ENTRY = re.compile(r'"([^"\\]+)"\s*:\s*"((?:\\.|[^"\\])*)"', re.DOTALL)
_PROOF_KEY = "_proof.only_fr"


def _entries(source: str) -> dict[str, str]:
    return dict(_ENTRY.findall(source))


def _frontend_gaps() -> list[str]:
    gaps: list[str] = []
    for path in sorted(_CATALOGS.glob("*.ts")):
        french_src, english_src = path.read_text(encoding="utf-8").split("export const en", 1)
        french = _entries(french_src)
        english = _entries(english_src)
        for key in sorted(set(french) - set(english)):
            gaps.append(f"{path.name}: {key}")
        for key in sorted(set(french) & set(english)):
            if english[key].strip() == "":
                gaps.append(f"{path.name}: {key} (empty)")
    return gaps


def test_every_french_catalog_key_has_english() -> None:
    missing_api = sorted(set(FR) - set(EN) - {_PROOF_KEY})
    assert missing_api == []
    assert _PROOF_KEY not in EN
    assert _frontend_gaps() == []
