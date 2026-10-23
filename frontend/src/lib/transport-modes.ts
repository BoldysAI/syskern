import type { TransportMode } from "@/lib/api";

/** Fallback labels — mirror `apps/market/seeds.py` when API unavailable. */
const FALLBACK_LABELS: Record<string, Record<string, string>> = {
  "40HQ": { fr: "Conteneur 40' High Cube", en: "40' High Cube container" },
  "40FT": { fr: "Conteneur 40'", en: "40' container" },
  "20FT": { fr: "Conteneur 20'", en: "20' container" },
  TRUCK_FULL: { fr: "Camion complet", en: "Full truckload" },
  TRUCK_LCL: { fr: "Camion groupé", en: "Less than truckload" },
  AIR_FREIGHT: { fr: "Fret aérien", en: "Air freight" },
  EXPRESS: { fr: "Express (UPS/DHL)", en: "Express (UPS/DHL)" },
};

function fallbackLabel(code: string, locale: string): string {
  const row = FALLBACK_LABELS[code];
  if (!row) return code;
  return row[locale] || row.fr || code;
}

export function localizeLabel(
  label: Record<string, string> | undefined,
  fallback: string,
  locale = "fr",
): string {
  if (!label) return fallback;
  return label[locale] || label.fr || label.en || Object.values(label)[0] || fallback;
}

/** Human-readable transport name from API list or seed fallback (never raw code in UI). */
export function transportModeLabel(
  code: string | undefined | null,
  modes?: TransportMode[],
  locale = "fr",
): string {
  if (!code) return "—";
  const fromApi = modes?.find((m) => m.code === code);
  if (fromApi) return localizeLabel(fromApi.label, fallbackLabel(code, locale), locale);
  return fallbackLabel(code, locale);
}

/** Build a code → label map for breakdown narration in the UI language. */
export function transportModeLabelMap(
  modes: TransportMode[],
  locale = "fr",
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const code of Object.keys(FALLBACK_LABELS)) {
    map[code] = fallbackLabel(code, locale);
  }
  for (const m of modes) {
    map[m.code] = localizeLabel(m.label, fallbackLabel(m.code, locale), locale);
  }
  return map;
}
