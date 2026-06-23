import type { ChainDraft, TransportDraft } from "@/app/simulator/new/_components/wizard-draft";
import { emptyChain } from "@/app/simulator/new/_components/wizard-draft";

export interface IncotermOption {
  code: string;
  label: Record<string, string>;
}

/** Static fallback when GET /api/incoterms is unavailable (11 ICC 2020 codes). */
export const INCOTERMS_FALLBACK: IncotermOption[] = [
  "EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP",
].map((code) => ({ code, label: { fr: code } }));

const NO_SALE_TRANSPORT = new Set(["EXW"]);
const NO_MAIN_SALE_TRANSPORT = new Set(["FCA", "FOB", "FAS"]);
const MAIN_SALE_TRANSPORT = new Set(["CFR", "CIF", "CPT", "CIP"]);
const DELIVERY_SALE_TRANSPORT = new Set(["DAP", "DPU"]);
const DELIVERY_WITH_CUSTOMS = new Set(["DDP"]);

const BUYER_PAYS_ALL = new Set(["EXW"]);
const TO_PORT = new Set(["FAS", "FOB"]);
const MAIN_INCLUDED = new Set(["CFR", "CIF", "CPT", "CIP"]);
const DELIVERED = new Set(["DAP", "DPU", "DDP"]);

/** Short FR impact text (CDC §12.2) for tooltips. */
export const INCOTERM_IMPACT_FR: Record<string, string> = {
  EXW: "Aucun transport ajouté côté vendeur — l'acheteur prend tout en charge.",
  FCA: "Transport jusqu'au point de remise au transporteur.",
  FAS: "Transport jusqu'au port d'embarquement (maritime).",
  FOB: "Transport jusqu'au chargement à bord (maritime).",
  CFR: "Fret principal inclus jusqu'au port de destination.",
  CIF: "Fret principal et assurance inclus jusqu'au port de destination.",
  CPT: "Transport principal inclus jusqu'à la destination (multimodal).",
  CIP: "Transport principal et assurance inclus (multimodal).",
  DAP: "Transport jusqu'à destination, sans douane import.",
  DPU: "Transport jusqu'à destination avec déchargement.",
  DDP: "Transport et douane import inclus — engagement maximal vendeur.",
};

function uid(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : String(Math.random());
}

function transportLeg(category: string, currency: string): TransportDraft {
  return {
    uid: uid(),
    transport_mode_code: "",
    category,
    global_cost: "",
    currency,
    pallet_count: "",
    from_location: "",
    to_location: "",
  };
}

export function localizeIncotermLabel(
  label: Record<string, string> | undefined,
  code: string
): string {
  if (!label) return code;
  return label.fr || label.en || Object.values(label)[0] || code;
}

/** Dominant purchase incoterm from line supplier snapshots (default FOB). */
export function dominantPurchaseIncoterm(
  snapshots: Array<{ incoterm?: string | null }>
): string {
  const counts = new Map<string, number>();
  for (const s of snapshots) {
    const code = s.incoterm?.trim();
    if (code) counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  if (counts.size === 0) return "FOB";
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/** True when the chain has user-entered transport/customs content. */
export function chainDraftHasContent(chain: ChainDraft): boolean {
  if (chain.transports.length > 0) return true;
  if (chain.customs.enabled) return true;
  return false;
}

/** Structural PV skeleton for a sale incoterm (no invented costs). */
export function suggestSaleChainDraft(incoterm: string): ChainDraft {
  const chain = emptyChain(false);
  const inc = incoterm || "EXW";

  if (MAIN_SALE_TRANSPORT.has(inc)) {
    chain.transports = [transportLeg("maritime", "USD")];
  } else if (DELIVERY_SALE_TRANSPORT.has(inc) || DELIVERY_WITH_CUSTOMS.has(inc)) {
    chain.transports = [transportLeg("road", "EUR")];
  }
  if (DELIVERY_WITH_CUSTOMS.has(inc)) {
    chain.customs = { enabled: true, rate_pct: "" };
  }
  return chain;
}

/** Structural PA skeleton for a purchase incoterm (no invented costs). */
export function suggestPurchaseChainDraft(incoterm: string): ChainDraft {
  const chain = emptyChain(true);
  const inc = incoterm || "FOB";

  if (BUYER_PAYS_ALL.has(inc) || TO_PORT.has(inc)) {
    chain.transports = [transportLeg("maritime", "USD"), transportLeg("road", "EUR")];
    chain.customs = { enabled: true, rate_pct: "" };
  } else if (MAIN_INCLUDED.has(inc)) {
    chain.transports = [transportLeg("road", "EUR")];
  } else if (inc === "DDP") {
    chain.customs = { enabled: true, rate_pct: "" };
  } else if (DELIVERED.has(inc)) {
    // Delivered purchase terms — minimal PA legs; user completes if needed.
  }
  return chain;
}

export function saleIncotermExpectsNoTransport(incoterm: string): boolean {
  return NO_SALE_TRANSPORT.has(incoterm) || NO_MAIN_SALE_TRANSPORT.has(incoterm);
}

export function formatIncotermDisplay(code: string, location?: string | null): string {
  const loc = location?.trim();
  return loc ? `${code} ${loc}` : code;
}

/** Lieux prédéfinis pour l'incoterm de vente (simulation / offre). */
export const SALE_INCOTERM_LOCATIONS = [
  "Port du Havre",
  "Port de Rotterdam",
  "Port de Shanghai",
  "Port de Ningbo",
  "Port de Mersin",
  "Usine Shanghai",
  "Usine Turquie",
  "Usine Chine",
  "Entrepôt Paris",
  "Entrepôt Réau",
  "Entrepôt Le Havre",
] as const;

export const SALE_INCOTERM_LOCATION_NONE = "__none__";
export const SALE_INCOTERM_LOCATION_OTHER = "__other__";

export function isPresetSaleIncotermLocation(location: string): boolean {
  const t = location.trim();
  return (SALE_INCOTERM_LOCATIONS as readonly string[]).includes(t);
}

/** Radix select value for the sale incoterm location field. */
export function saleIncotermLocationSelectValue(location: string): string {
  const t = location.trim();
  if (!t) return SALE_INCOTERM_LOCATION_NONE;
  if (isPresetSaleIncotermLocation(t)) return t;
  return SALE_INCOTERM_LOCATION_OTHER;
}

/** Visible label for the location select trigger (no children on Select.Value — React 19). */
export function saleIncotermLocationDisplayLabel(
  location: string,
  otherExplicit = false
): string {
  return resolveSaleIncotermLocationUi(location, otherExplicit).displayLabel;
}

/** UI state for the sale incoterm location select + optional custom field. */
export function resolveSaleIncotermLocationUi(
  location: string,
  otherExplicit: boolean,
  emptyLabel = "Choisir un lieu…"
) {
  const t = location.trim();
  if (otherExplicit || (t && !isPresetSaleIncotermLocation(t))) {
    return {
      selectValue: SALE_INCOTERM_LOCATION_OTHER,
      showCustom: true,
      displayLabel: "Autre…",
    };
  }
  if (!t) {
    return {
      selectValue: SALE_INCOTERM_LOCATION_NONE,
      showCustom: false,
      displayLabel: emptyLabel,
    };
  }
  return {
    selectValue: t,
    showCustom: false,
    displayLabel: t,
  };
}
