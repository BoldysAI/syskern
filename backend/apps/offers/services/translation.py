"""DeepL translation client (CDC §10.4).

Thin ``httpx`` wrapper around the DeepL REST API. The client itself is
stateless and knows nothing about caching — persistence / cache lives in
``apps.i18n`` (``TranslationCache`` + ``services.translate_cached``).

Behaviour mandated by CDC §10.4:
- §10.4.1 : ``formality=more`` + ``preserve_formatting`` on every call.
- §10.4.4 : 456 → quota, timeout 10 s + 2 retries on 5xx (incl. 503),
  source text validated (empty short-circuits, > 5000 chars rejected),
  auth failure logged + emailed to the Boldys maintainers.
"""

from __future__ import annotations

import logging
import time

import httpx
from django.conf import settings

logger = logging.getLogger("apps.offers.services.translation")

# CDC §10.4.4 — reject anything longer than this before hitting DeepL.
MAX_TEXT_LENGTH = 5000
# CDC §10.4.4 — timeout 10 s, retry twice, then fail.
DEFAULT_TIMEOUT = 10.0
MAX_RETRIES = 2
_RETRY_BACKOFF_SECONDS = 0.5
# DeepL accepts formality only for some target languages (not EN).
_FORMALITY_TARGET_LANGS = frozenset({"de", "fr", "it", "es", "nl", "pl", "pt", "pt-br", "pt-pt", "ru", "ja"})
# Small words ignored when detecting English-style Title Case in the source.
_TITLE_CASE_SMALL_WORDS = frozenset(
    {"a", "an", "and", "as", "at", "but", "by", "for", "in", "nor", "of", "on", "or", "the", "to", "vs", "via"}
)


def _has_letter(s: str) -> bool:
    return any(c.isalpha() for c in s)


def _is_all_upper(s: str) -> bool:
    letters = [c for c in s if c.isalpha()]
    return bool(letters) and all(c.isupper() for c in letters)


def _is_all_lower(s: str) -> bool:
    letters = [c for c in s if c.isalpha()]
    return bool(letters) and all(c.islower() for c in letters)


def _is_title_case(s: str) -> bool:
    words = s.split()
    if len(words) < 2:
        return False
    titled = 0
    for word in words:
        core = word.lstrip("-•*·")
        if not core or not core[0].isalpha():
            continue
        if core.lower() in _TITLE_CASE_SMALL_WORDS:
            continue
        if core[0].isupper():
            titled += 1
        else:
            return False
    return titled >= 1


def _to_title_case(s: str) -> str:
    def fix_word(word: str) -> str:
        lead = 0
        while lead < len(word) and not word[lead].isalpha():
            lead += 1
        if lead >= len(word):
            return word
        return word[:lead] + word[lead].upper() + word[lead + 1 :].lower()

    return " ".join(fix_word(w) for w in s.split())


def _capitalize_first_letter(s: str) -> str:
    for i, c in enumerate(s):
        if c.isalpha():
            return s[:i] + c.upper() + s[i + 1 :]
    return s


def _first_alpha_is_upper(s: str) -> bool:
    for c in s:
        if c.isalpha():
            return c.isupper()
    return False


def apply_source_casing(source_text: str, translated_text: str) -> str:
    """Mirror the source capitalization onto the translation (line by line).

    DeepL applies target-language typography — with ``formality=more`` on FR/ES this
  often lowercases English Title Case or ALL CAPS headings. Re-aligning to the
    source pattern keeps EN→FR edits faithful without touching FR→EN (no formality).
    """
    if not translated_text or not source_text:
        return translated_text
    src_lines = source_text.split("\n")
    tgt_lines = translated_text.split("\n")
    if len(src_lines) != len(tgt_lines):
        return _apply_line_casing(source_text, translated_text)
    return "\n".join(
        _apply_line_casing(s, t) for s, t in zip(src_lines, tgt_lines, strict=False)
    )


def _apply_line_casing(source: str, translated: str) -> str:
    if not translated or not _has_letter(source):
        return translated
    s = source.strip()
    t = translated.strip()
    if not s or not t:
        return translated

    if _is_all_upper(s):
        result = t.upper()
    elif _is_all_lower(s):
        result = t.lower()
    elif _is_title_case(s):
        result = _to_title_case(t)
    elif _first_alpha_is_upper(s) and not _is_all_upper(s):
        result = _capitalize_first_letter(t)
    else:
        return translated

    lead = translated[: len(translated) - len(translated.lstrip())]
    trail = translated[len(translated.rstrip()) :]
    return lead + result + trail


class TranslationError(RuntimeError):
    """Base error for the DeepL client — carries a user-facing French message."""


class TranslationQuotaError(TranslationError):
    """DeepL quota exceeded (HTTP 456)."""


class TranslationUnavailableError(TranslationError):
    """DeepL temporarily unavailable (5xx / network, retries exhausted)."""


class TranslationInputError(TranslationError):
    """Source text failed local validation (too long)."""


class DeepLClient:
    PRO_BASE_URL = "https://api.deepl.com/v2"
    FREE_BASE_URL = "https://api-free.deepl.com/v2"

    def __init__(self, api_key: str | None = None, timeout: float = DEFAULT_TIMEOUT):
        self.api_key = api_key or settings.DEEPL_API_KEY
        self.timeout = timeout

    @property
    def base_url(self) -> str:
        """Resolve Pro vs Free API host for the configured key.

        DeepL free-tier keys end with ``:fx`` and must call ``api-free.deepl.com``.
        Pro keys use ``api.deepl.com``. A wrong host returns HTTP 403 even with a
        valid key — the most common local-dev misconfiguration.
        """
        override = (getattr(settings, "DEEPL_API_URL", None) or "").strip()
        if override:
            return override.rstrip("/")
        key = (self.api_key or "").strip()
        if key.endswith(":fx"):
            return self.FREE_BASE_URL
        return self.PRO_BASE_URL

    # ── Public API ───────────────────────────────────────────────────────────

    def translate(self, *, source_text: str, source_lang: str, target_lang: str) -> str:
        """Translate a single string ``source_lang`` → ``target_lang``.

        Empty inputs short-circuit to ``""`` to avoid quota waste.
        """
        if not source_text or not source_text.strip():
            return ""
        results = self._request([source_text], source_lang, target_lang)
        raw = results[0] if results else ""
        return apply_source_casing(source_text, raw)

    def translate_batch(self, texts: list[str], source_lang: str, target_lang: str) -> list[str]:
        """Translate several strings in one DeepL call.

        Preserves order and length: empty inputs map to ``""`` without being
        sent to DeepL. Returns a list the same length as ``texts``.
        """
        # Map non-empty entries to their original index so we can splice the
        # DeepL results back in place and keep empty strings empty.
        payload_texts: list[str] = []
        positions: list[int] = []
        for i, text in enumerate(texts):
            if text and text.strip():
                payload_texts.append(text)
                positions.append(i)

        out = [""] * len(texts)
        if not payload_texts:
            return out

        translated = self._request(payload_texts, source_lang, target_lang)
        for pos, src, value in zip(positions, payload_texts, translated, strict=False):
            out[pos] = apply_source_casing(src, value)
        return out

    # ── Internals ──────────────────────────────────────────────────────────

    @staticmethod
    def _deepl_lang(lang: str) -> str:
        return lang.strip().lower()

    @classmethod
    def _supports_formality(cls, target_lang: str) -> bool:
        return cls._deepl_lang(target_lang) in _FORMALITY_TARGET_LANGS

    def _request(self, texts: list[str], source_lang: str, target_lang: str) -> list[str]:
        if not self.api_key:
            raise TranslationError(
                "Service de traduction non configuré. Ajoutez DEEPL_API_KEY dans backend/.env."
            )
        for text in texts:
            if len(text) > MAX_TEXT_LENGTH:
                raise TranslationInputError(
                    f"Texte trop long ({len(text)} caractères, maximum {MAX_TEXT_LENGTH})."
                )

        data = {
            "text": texts,
            "source_lang": source_lang.upper(),
            "target_lang": target_lang.upper(),
            "preserve_formatting": "1",
        }
        if self._supports_formality(target_lang):
            data["formality"] = "more"

        headers = {"Authorization": f"DeepL-Auth-Key {(self.api_key or '').strip()}"}

        last_exc: Exception | None = None
        # Initial attempt + MAX_RETRIES retries on 5xx / network errors.
        for attempt in range(MAX_RETRIES + 1):
            try:
                with httpx.Client(base_url=self.base_url, timeout=self.timeout) as client:
                    response = client.post("/translate", data=data, headers=headers)
            except httpx.HTTPError as exc:
                last_exc = exc
                logger.warning("DeepL network error (attempt %d): %s", attempt + 1, exc)
                if attempt < MAX_RETRIES:
                    time.sleep(_RETRY_BACKOFF_SECONDS * (attempt + 1))
                    continue
                raise TranslationUnavailableError(
                    "Service de traduction temporairement indisponible."
                ) from exc

            if response.status_code == 200:
                payload = response.json()
                return [t["text"] for t in payload.get("translations", [])]

            if response.status_code == 456:
                raise TranslationQuotaError("Quota de traduction dépassé.")

            if response.status_code in (401, 403):
                detail = self._response_detail(response)
                self._alert_auth_failure(response.status_code, detail)
                raise TranslationError(detail or "Erreur d'authentification DeepL.")

            if response.status_code >= 500:
                last_exc = TranslationUnavailableError(f"DeepL returned {response.status_code}.")
                logger.warning(
                    "DeepL 5xx (attempt %d): %s — %s",
                    attempt + 1,
                    response.status_code,
                    response.text[:200],
                )
                if attempt < MAX_RETRIES:
                    time.sleep(_RETRY_BACKOFF_SECONDS * (attempt + 1))
                    continue
                raise TranslationUnavailableError(
                    "Service de traduction temporairement indisponible."
                )

            # Other 4xx — non-retryable client error.
            raise TranslationError(f"DeepL returned {response.status_code}: {response.text[:200]}")

        # Unreachable in practice (loop always returns or raises), but keeps
        # the type checker happy.
        raise TranslationUnavailableError(
            "Service de traduction temporairement indisponible."
        ) from last_exc

    @staticmethod
    def _response_detail(response: httpx.Response) -> str:
        try:
            payload = response.json()
        except ValueError:
            return response.text[:200]
        message = payload.get("message")
        return str(message) if message else response.text[:200]

    @staticmethod
    def _alert_auth_failure(status_code: int, detail: str = "") -> None:
        """Log + email the maintainers on a DeepL auth failure (CDC §10.4.4)."""
        logger.error("DeepL authentication failure (HTTP %d): %s", status_code, detail or "n/a")
        recipients = list(getattr(settings, "TRANSLATION_AUTH_ALERT_RECIPIENTS", []) or [])
        if not recipients:
            return
        try:
            from django.core.mail import send_mail

            send_mail(
                subject="[Syskern] Échec d'authentification DeepL",
                message=(
                    "L'API DeepL a retourné une erreur d'authentification "
                    f"(HTTP {status_code}). Vérifier la clé DEEPL_API_KEY."
                    + (f"\n\nDétail DeepL : {detail}" if detail else "")
                ),
                from_email=getattr(settings, "DEFAULT_FROM_EMAIL", "noreply@syskern.local"),
                recipient_list=recipients,
                fail_silently=True,
            )
        except Exception:  # noqa: BLE001 — alerting must never break translation flow
            logger.exception("Failed to send DeepL auth alert email")
