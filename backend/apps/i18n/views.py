"""Translation endpoint (CDC §10.4.2).

``POST /api/translate`` — the frontend never calls DeepL directly; this endpoint
centralises logging, error handling and the read-through cache. Single-field and
small-batch translations are served **synchronously** here (short, bounded,
cached); multi-product bulk translation goes through Celery
(``products.bulk_translate_products_task``). Deviation from AGENTS.md §4 is
documented in decisions.md.
"""

from __future__ import annotations

from rest_framework import status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.offers.services.translation import (
    TranslationError,
    TranslationInputError,
    TranslationQuotaError,
    TranslationUnavailableError,
)

from .serializers import TranslateRequestSerializer
from .services import translate_cached, translate_many_cached


class TranslateView(APIView):
    """Translate a string or a small batch via DeepL, with caching."""

    def post(self, request: Request) -> Response:
        ser = TranslateRequestSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        source_lang = data["source_lang"]
        target_lang = data["target_lang"]

        try:
            if "texts" in data:
                pairs = translate_many_cached(data["texts"], source_lang, target_lang)
                return Response(
                    {
                        "translations": [
                            {"translated_text": text, "from_cache": from_cache}
                            for text, from_cache in pairs
                        ]
                    }
                )
            translated, from_cache = translate_cached(data["text"], source_lang, target_lang)
            return Response({"translated_text": translated, "from_cache": from_cache})
        except TranslationQuotaError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_402_PAYMENT_REQUIRED)
        except TranslationUnavailableError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        except TranslationInputError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except TranslationError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
