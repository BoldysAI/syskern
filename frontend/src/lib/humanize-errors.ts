import { translate } from "@/lib/i18n";

/**
 * Map pricing-engine / API error strings to French, user-facing copy.
 * Mirrors backend `engine/errors.py` for legacy diagnostics already stored in DB.
 */

const FX_PARAM_LABELS: Record<string, string> = {
  fx_eur_usd: "EUR → USD",
  fx_eur_rmb: "EUR → RMB",
  fx_eur_jpy: "EUR → JPY",
  fx_eur_gbp: "EUR → GBP",
};

const MISSING_FX_RE = /^Missing FX rate `(fx_eur_\w+)` in market parameters\.$/;

function missingFxRateMessage(paramKey: string, locale: string): string {
  const label = FX_PARAM_LABELS[paramKey];
  if (label) {
    return translate("common.missingFxRate", locale, { label });
  }
  return translate("common.missingFxRateGeneric", locale);
}

function looksUserFacing(msg: string): boolean {
  if (/[àâçéèêëîïôùûüœ]/i.test(msg)) return true;
  const prefixes = [
    "Produit ",
    "Taux ",
    "Paramètres ",
    "Mix ",
    "Incoterm ",
    "Le ",
    "La ",
    "Des ",
    "Impossible",
    "Une ",
    "Aucun",
  ];
  return prefixes.some((p) => msg.startsWith(p));
}

/** Humanize a single engine diagnostic line (error or warning). */
export function humanizeEngineMessage(msg: string, locale = "fr"): string {
  const trimmed = msg.trim();
  if (!trimmed) return trimmed;

  const fx = MISSING_FX_RE.exec(trimmed);
  if (fx) return missingFxRateMessage(fx[1], locale);

  if (trimmed.startsWith("mix_pct must be in")) {
    return translate("common.invalidMix", locale);
  }

  if (looksUserFacing(trimmed)) return trimmed;

  return translate("common.calculationFailed", locale);
}

/** Extract `detail` from `apiFetch` errors (`API 4xx: {"detail":"..."}`). */
export function humanizeApiError(error: unknown, fallback: string, locale = "fr"): string {
  if (!(error instanceof Error)) return fallback;
  // `[\s\S]` instead of the `s` (dotAll) flag, which needs an es2018+ target.
  const match = error.message.match(/^API \d+: ([\s\S]+)$/);
  if (match) {
    try {
      const body = JSON.parse(match[1]) as { detail?: unknown };
      if (typeof body.detail === "string" && body.detail.trim()) {
        return body.detail;
      }
    } catch {
      // Not JSON — fall through.
    }
  }
  const msg = error.message.trim();
  if (msg && !looksUserFacing(msg) && !msg.startsWith("API ")) {
    return fallback;
  }
  return humanizeEngineMessage(msg, locale) || fallback;
}
