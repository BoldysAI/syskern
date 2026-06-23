import type { SimulationType } from "@/lib/api";

/** A SKU picked for the simulation (any of the 3 selection methods). */
export interface SelectedSku {
  id: string;
  sku_code: string;
  name: string;
}

/** A single transport leg in a calculation chain (CDC §6.2). */
export interface TransportDraft {
  /** Local-only id, used as the drag-and-drop key. */
  uid: string;
  transport_mode_code: string;
  category: string;
  global_cost: string;
  currency: string;
  pallet_count: string;
  from_location: string;
  to_location: string;
}

export interface CustomsDraft {
  enabled: boolean;
  /** Customs duty as a percentage of the input price (e.g. "5" → +5 %). */
  rate_pct: string;
  /** @internal Legacy persisted chains (global cost mode) — not edited in UI. */
  legacyGlobalCost?: string;
  legacyCurrency?: string;
  legacyTotalQuantity?: string;
}

/** One side of the chain (PA or PV). Copper/currency only apply to PA. */
export interface ChainDraft {
  copper_variation: boolean;
  currency_conversion: boolean;
  transports: TransportDraft[];
  customs: CustomsDraft;
}

export interface MarketParamsDraft {
  copper_base_price_rmb: string;
  copper_current_price_rmb: string;
  fx_eur_rmb: string;
  fx_eur_usd: string;
}

export type SymeaPosition = "after_transports" | "before_transports";

export interface WizardDraft {
  // Step 1 — type & context
  label: string;
  type: SimulationType;
  clientIds: string[];
  projectName: string;
  // Step 2 — SKU selection (cumulative)
  selectedSkus: SelectedSku[];
  // Step 3 — market params & chains
  marketParams: MarketParamsDraft;
  purchaseChain: ChainDraft;
  saleChain: ChainDraft;
  mixPct: number;
  symeaPct: string;
  syskernPct: string;
  symeaPosition: SymeaPosition;
  /** Sale-side commercial hypothesis (CDC §6.8.3). */
  saleIncoterm: string;
  saleIncotermLocation: string;
}

export const DRAFT_KEY = "syskern:new-simulation-draft:v1";

export function emptyChain(withPurchaseModules: boolean): ChainDraft {
  return {
    copper_variation: withPurchaseModules,
    currency_conversion: withPurchaseModules,
    transports: [],
    customs: { enabled: false, rate_pct: "" },
  };
}

export function emptyDraft(): WizardDraft {
  return {
    label: "",
    type: "tariff",
    clientIds: [],
    projectName: "",
    selectedSkus: [],
    marketParams: {
      copper_base_price_rmb: "",
      copper_current_price_rmb: "",
      fx_eur_rmb: "",
      fx_eur_usd: "",
    },
    purchaseChain: emptyChain(true),
    saleChain: emptyChain(false),
    mixPct: 0,
    symeaPct: "6",
    syskernPct: "20",
    symeaPosition: "after_transports",
    saleIncoterm: "EXW",
    saleIncotermLocation: "",
  };
}

/** Restore a persisted draft (lazy initializer). Never throws (SSR / quota). */
export function loadDraft(): WizardDraft {
  if (typeof window === "undefined") return emptyDraft();
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return emptyDraft();
    const parsed = JSON.parse(raw) as Partial<WizardDraft>;
    const base = emptyDraft();
    return {
      ...base,
      ...parsed,
      marketParams: { ...base.marketParams, ...(parsed.marketParams ?? {}) },
      purchaseChain: { ...base.purchaseChain, ...(parsed.purchaseChain ?? {}) },
      saleChain: { ...base.saleChain, ...(parsed.saleChain ?? {}) },
      selectedSkus: parsed.selectedSkus ?? [],
      clientIds: parsed.clientIds ?? [],
    };
  } catch {
    return emptyDraft();
  }
}

export function persistDraft(draft: WizardDraft): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Ignore private-mode / quota errors.
  }
}

export function clearDraft(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Ignore.
  }
}

/** Convert a percentage string ("6") to a 4-decimal rate string ("0.0600"). */
export function pctToDecimal(pct: string): string {
  const n = parseFloat(pct);
  return Number.isFinite(n) ? (n / 100).toFixed(4) : "0.0000";
}

/** Inverse of `pctToDecimal` — for loading a simulation into the edit form. */
export function decimalToPct(v?: string | null): string {
  if (v == null || v === "") return "";
  const n = parseFloat(v);
  return Number.isFinite(n) ? String(Math.round(n * 10000) / 100) : "";
}

function uid(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : String(Math.random());
}

function parseTransportDraft(t: Record<string, unknown>): TransportDraft {
  const pallets = t.pallet_count;
  return {
    uid: uid(),
    transport_mode_code: String(t.transport_mode_code ?? ""),
    category: String(t.category ?? ""),
    global_cost: t.global_cost != null ? String(t.global_cost) : "",
    currency: String(t.currency ?? "EUR"),
    pallet_count:
      pallets != null && pallets !== "" && Number(pallets) !== 0 ? String(pallets) : "",
    from_location: String(t.from_location ?? ""),
    to_location: String(t.to_location ?? ""),
  };
}

function parseChainDraft(chain: Record<string, unknown>, isPurchase: boolean): ChainDraft {
  const transports = ((chain.transports as Record<string, unknown>[]) ?? []).map(parseTransportDraft);
  const customs = chain.customs as Record<string, unknown> | null | undefined;
  return {
    copper_variation: isPurchase && chain.copper_variation != null,
    currency_conversion: isPurchase && chain.currency_conversion != null,
    transports,
    customs: {
      enabled: customs != null,
      rate_pct: customs?.rate_pct != null ? String(customs.rate_pct) : "",
      legacyGlobalCost:
        customs?.global_cost != null ? String(customs.global_cost) : undefined,
      legacyCurrency: customs?.currency != null ? String(customs.currency) : undefined,
      legacyTotalQuantity:
        customs?.total_quantity != null ? String(customs.total_quantity) : undefined,
    },
  };
}

/** Hydrate wizard fields from an existing simulation (edit flow — no SKU list). */
export function simulationToEditDraft(sim: {
  label: string;
  simulation_type: SimulationType;
  client_ids: string[];
  project_name: string;
  market_params: Record<string, unknown>;
  calculation_chain: Record<string, unknown>;
  stock_purchase_mix_pct: number;
  symea_margin_rate: string;
  syskern_margin_rate: string;
  sale_incoterm?: string;
  sale_incoterm_location?: string;
}): WizardDraft {
  const chain = sim.calculation_chain ?? {};
  const purchase = (chain.purchase_chain ?? {}) as Record<string, unknown>;
  const sale = (chain.sale_chain ?? {}) as Record<string, unknown>;
  const symea = (purchase.symea_margin ?? {}) as Record<string, unknown>;
  const mp = sim.market_params ?? {};

  return {
    label: sim.label,
    type: sim.simulation_type,
    clientIds: [...(sim.client_ids ?? [])],
    projectName: sim.project_name ?? "",
    selectedSkus: [],
    marketParams: {
      copper_base_price_rmb: String(mp.copper_base_price_rmb ?? ""),
      copper_current_price_rmb: String(mp.copper_current_price_rmb ?? ""),
      fx_eur_rmb: String(mp.fx_eur_rmb ?? ""),
      fx_eur_usd: String(mp.fx_eur_usd ?? ""),
    },
    purchaseChain: parseChainDraft(purchase, true),
    saleChain: parseChainDraft(sale, false),
    mixPct: sim.stock_purchase_mix_pct ?? 0,
    symeaPct: decimalToPct(sim.symea_margin_rate) || "6",
    syskernPct: decimalToPct(sim.syskern_margin_rate) || "20",
    symeaPosition: (symea.position as SymeaPosition) ?? "after_transports",
    saleIncoterm: sim.sale_incoterm ?? "EXW",
    saleIncotermLocation: sim.sale_incoterm_location ?? "",
  };
}

export function buildMarketParams(mp: MarketParamsDraft): Record<string, string> {
  const out: Record<string, string> = {};
  if (mp.copper_base_price_rmb) out.copper_base_price_rmb = mp.copper_base_price_rmb;
  if (mp.copper_current_price_rmb) out.copper_current_price_rmb = mp.copper_current_price_rmb;
  if (mp.fx_eur_rmb) out.fx_eur_rmb = mp.fx_eur_rmb;
  if (mp.fx_eur_usd) out.fx_eur_usd = mp.fx_eur_usd;
  return out;
}

/** PATCH body for `updateSimulation` from wizard-shaped fields. */
export function buildSimulationPatch(
  draft: Pick<
    WizardDraft,
    | "label"
    | "type"
    | "clientIds"
    | "projectName"
    | "marketParams"
    | "purchaseChain"
    | "saleChain"
    | "mixPct"
    | "symeaPct"
    | "syskernPct"
    | "symeaPosition"
    | "saleIncoterm"
    | "saleIncotermLocation"
  >
) {
  return {
    label: draft.label.trim(),
    simulation_type: draft.type,
    project_name: draft.type === "project" ? draft.projectName.trim() : "",
    client_ids: draft.clientIds,
    stock_purchase_mix_pct: draft.mixPct,
    symea_margin_rate: pctToDecimal(draft.symeaPct),
    syskern_margin_rate: pctToDecimal(draft.syskernPct),
    sale_incoterm: draft.saleIncoterm || "EXW",
    sale_incoterm_location: draft.saleIncotermLocation.trim(),
    market_params: buildMarketParams(draft.marketParams),
    calculation_chain: buildCalculationChain(draft as WizardDraft),
  };
}

export function step1Valid(draft: Pick<WizardDraft, "label" | "type" | "projectName" | "clientIds">): boolean {
  return (
    draft.label.trim().length > 0 &&
    (draft.type === "tariff" ||
      (draft.projectName.trim().length > 0 && draft.clientIds.length === 1))
  );
}

function buildTransports(transports: TransportDraft[]): Record<string, unknown>[] {
  return transports.map((t, i) => ({
    order: i + 1,
    transport_mode_code: t.transport_mode_code,
    category: t.category,
    global_cost: t.global_cost || "0",
    currency: t.currency,
    pallet_count: t.pallet_count ? parseInt(t.pallet_count, 10) : 0,
    from_location: t.from_location,
    to_location: t.to_location,
    override_coefficient: null,
  }));
}

function buildCustoms(customs: CustomsDraft): Record<string, unknown> | null {
  if (!customs.enabled) return null;
  if (customs.rate_pct.trim()) {
    return { rate_pct: customs.rate_pct.trim() };
  }
  // Legacy global-cost mode (simulations created before percentage UI).
  if (customs.legacyGlobalCost?.trim()) {
    const payload: Record<string, unknown> = {
      global_cost: customs.legacyGlobalCost.trim(),
      currency: customs.legacyCurrency ?? "EUR",
    };
    if (customs.legacyTotalQuantity?.trim()) {
      payload.total_quantity = customs.legacyTotalQuantity.trim();
    }
    return payload;
  }
  return { rate_pct: "0" };
}

/** Assemble the `calculation_chain` JSON consumed by the runner (CDC §6.2). */
export function buildCalculationChain(draft: WizardDraft): Record<string, unknown> {
  const { purchaseChain, saleChain } = draft;

  const purchase: Record<string, unknown> = {
    transports: buildTransports(purchaseChain.transports),
    customs: buildCustoms(purchaseChain.customs),
    symea_margin: {
      rate: pctToDecimal(draft.symeaPct),
      position: draft.symeaPosition,
    },
  };
  if (purchaseChain.copper_variation) purchase.copper_variation = {};
  if (purchaseChain.currency_conversion) {
    purchase.currency_conversion = { to_currency: "EUR" };
  }

  const sale: Record<string, unknown> = {
    transports: buildTransports(saleChain.transports),
    customs: buildCustoms(saleChain.customs),
    syskern_margin: { rate: pctToDecimal(draft.syskernPct) },
  };

  return { purchase_chain: purchase, sale_chain: sale };
}

/** Returns a French error message when a transport leg is missing pallet_count. */
export function validateTransportChains(draft: WizardDraft): string | null {
  const check = (label: string, chain: ChainDraft) => {
    for (let i = 0; i < chain.transports.length; i++) {
      const pallets = parseInt(chain.transports[i].pallet_count, 10);
      if (!Number.isFinite(pallets) || pallets <= 0) {
        return `Transport ${label} (${i + 1}) : indiquez un nombre de palettes supérieur à 0.`;
      }
    }
    return null;
  };
  return check("PA", draft.purchaseChain) ?? check("PV", draft.saleChain);
}

/** Preset "Standard import Chine" — structural only, no invented monetary values. */
export function applyImportChinePreset(): { purchase: ChainDraft; sale: ChainDraft } {
  const uid = () =>
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : String(Math.random());
  const leg = (category: string, currency: string): TransportDraft => ({
    uid: uid(),
    transport_mode_code: "",
    category,
    global_cost: "",
    currency,
    pallet_count: "",
    from_location: "",
    to_location: "",
  });
  return {
    purchase: {
      copper_variation: true,
      currency_conversion: true,
      transports: [leg("maritime", "USD"), leg("road", "EUR")],
      customs: { enabled: true, rate_pct: "" },
    },
    sale: emptyChain(false),
  };
}
