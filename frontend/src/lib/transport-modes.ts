import type { TransportMode } from "@/lib/api";

/** Fallback FR labels — mirror `apps/market/seeds.py` when API unavailable. */
const FALLBACK_LABELS_FR: Record<string, string> = {
  "40HQ": "Conteneur 40' High Cube",
  "40FT": "Conteneur 40'",
  "20FT": "Conteneur 20'",
  TRUCK_FULL: "Camion complet",
  TRUCK_LCL: "Camion groupé",
  AIR_FREIGHT: "Fret aérien",
  EXPRESS: "Express (UPS/DHL)",
};

export function localizeLabel(
  label: Record<string, string> | undefined,
  fallback: string
): string {
  if (!label) return fallback;
  return label.fr || label.en || Object.values(label)[0] || fallback;
}

/** Human-readable transport name from API list or seed fallback (never raw code in UI). */
export function transportModeLabel(
  code: string | undefined | null,
  modes?: TransportMode[]
): string {
  if (!code) return "—";
  const fromApi = modes?.find((m) => m.code === code);
  if (fromApi) return localizeLabel(fromApi.label, code);
  return FALLBACK_LABELS_FR[code] ?? code;
}

/** Build a code → FR label map for breakdown narration. */
export function transportModeLabelMap(modes: TransportMode[]): Record<string, string> {
  const map: Record<string, string> = { ...FALLBACK_LABELS_FR };
  for (const m of modes) {
    map[m.code] = localizeLabel(m.label, m.code);
  }
  return map;
}
