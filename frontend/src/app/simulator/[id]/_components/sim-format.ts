import type { SimulationLine, SimulationLineStatus } from "@/lib/api";
import { buildProductHref } from "@/lib/product-navigation";
import { humanizeEngineMessage } from "@/lib/humanize-errors";
import { formatUiNumber, translate, uiDateLocale, type MessageKey } from "@/lib/i18n";
import { transportModeLabel as defaultTransportModeLabel } from "@/lib/transport-modes";

function tr(
  locale: string,
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  return translate(key, locale, vars);
}

/**
 * Extract human-readable diagnostics from a line's `calculation_breakdown`.
 * Supports the standardized `errors[]`/`warnings[]` shape and the legacy
 * single-string `error` key. Used to surface WHY a result is 0/missing instead
 * of showing a silent value.
 */
export function lineDiagnostics(line: SimulationLine): {
  errors: string[];
  warnings: string[];
} {
  const b = (line.calculation_breakdown ?? {}) as {
    errors?: unknown;
    warnings?: unknown;
    error?: unknown;
  };
  const errors = Array.isArray(b.errors)
    ? b.errors.map((m) => humanizeEngineMessage(String(m)))
    : [];
  const warnings = Array.isArray(b.warnings)
    ? b.warnings.map((m) => humanizeEngineMessage(String(m)))
    : [];
  if (typeof b.error === "string" && b.error) {
    const humanized = humanizeEngineMessage(b.error);
    if (!errors.includes(humanized)) errors.unshift(humanized);
  }
  return { errors, warnings };
}

/** Context when opening a product fiche from a simulation line. */
export interface ProductEditFromSimulation {
  simulationId: string;
  simulationLabel: string;
}

/** Context when opening a simulation from a product fiche (e.g. price history chart). */
export interface SimulationFromCatalog {
  productSku: string;
  productLabel: string;
  /** Tab to restore on the product fiche when navigating back via breadcrumb. */
  productTab?: string;
}

/** Deep-link to the product fiche in edit mode, optionally opening a relevant tab. */
export function productEditHref(
  sku: string,
  messages: string[] = [],
  fromSimulation?: ProductEditFromSimulation,
): string {
  const joined = messages.join(" ").toLowerCase();
  let tab: string | undefined;
  if (joined.includes("pallet_qty") || joined.includes("palette")) {
    tab = "logistics";
  } else if (joined.includes("prix d'achat") || joined.includes("(po)")) {
    tab = "commercial";
  }

  const ctx = fromSimulation
    ? {
        kind: "simulation" as const,
        simulationId: fromSimulation.simulationId,
        simulationLabel: fromSimulation.simulationLabel,
      }
    : { kind: "catalog" as const };

  return buildProductHref(sku, ctx, { edit: true, tab });
}

/** Deep-link to a simulation, preserving catalog breadcrumb context on return. */
export function simulationHrefFromCatalog(
  simulationId: string,
  fromCatalog: SimulationFromCatalog,
): string {
  const q = new URLSearchParams({
    from: "catalog",
    product_sku: fromCatalog.productSku,
    product_label: fromCatalog.productLabel,
  });
  if (fromCatalog.productTab) q.set("product_tab", fromCatalog.productTab);
  return `/simulator/${simulationId}?${q.toString()}`;
}

/** Format a Decimal-string money value as EUR for display (never for math). */
export function fmtEur(v?: string | null, locale = "fr"): string {
  if (v == null || v === "") return "—";
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return "—";
  return `${formatUiNumber(n, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

/** Format a plain number-ish string (e.g. stock) for display. */
export function fmtNum(v?: string | null, locale = "fr"): string {
  if (v == null || v === "") return "—";
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return "—";
  return formatUiNumber(n, locale, { maximumFractionDigits: 2 });
}

/** Decimal rate string ("0.0600") → percent display string ("6"). */
export function decToPct(v?: string | null): string {
  if (v == null || v === "") return "";
  const n = parseFloat(v);
  return Number.isFinite(n) ? String(Math.round(n * 10000) / 100) : "";
}

export const LINE_STATUS: Record<SimulationLineStatus, { badge: string; row: string }> = {
  ok: { badge: "border border-primary/20 bg-primary/10 text-primary", row: "" },
  pending: { badge: "bg-muted text-muted-foreground", row: "" },
  warning: { badge: "border border-warm/30 bg-warm/10 text-warm", row: "bg-warm/5" },
  error: { badge: "bg-destructive/10 text-destructive", row: "bg-destructive/5" },
  dirty: { badge: "border border-data-dirty/30 bg-data-dirty/10 text-data-dirty", row: "bg-data-dirty/10" },
};

const LINE_STATUS_KEYS: Record<SimulationLineStatus, MessageKey> = {
  ok: "simulator.status.ok",
  pending: "simulator.status.pending",
  warning: "simulator.status.warning",
  error: "common.error",
  dirty: "simulator.status.modified",
};

export function lineStatusLabel(status: SimulationLineStatus, locale: string): string {
  return translate(LINE_STATUS_KEYS[status] ?? LINE_STATUS_KEYS.pending, locale);
}

/** Row background classes for simulation line tables. */
export function lineRowClassName(status: SimulationLineStatus): string {
  const st = LINE_STATUS[status] ?? LINE_STATUS.pending;
  if (st.row) return `${st.row} hover:bg-muted/40`;
  return "even:bg-muted/30 hover:bg-warm/10";
}

/** Read a frozen market_params value for display. */
export function mpStr(mp: Record<string, unknown> | undefined, key: string): string {
  const v = mp?.[key];
  return v == null || v === "" ? "—" : String(v);
}

/** Human-readable labels for pricing-chain modules. */
const MODULE_LABEL_KEYS: Record<string, MessageKey> = {
  copper_variation: "simulator.module.copper",
  currency_conversion: "simulator.module.currency",
  transport: "simulator.module.transport",
  customs: "simulator.module.customs",
  symea_margin: "simulator.module.symea",
  syskern_margin: "simulator.module.syskern",
  margin: "simulator.module.margin",
  predictive_pamp: "simulator.module.pamp",
  pr_mix: "simulator.module.prMix",
};

/** Passthrough reasons stored in step metadata when a module is skipped. */
const PASSTHROUGH_KEYS: Record<string, MessageKey> = {
  not_applicable: "simulator.passthrough.notApplicable",
  indexed_without_weight: "simulator.passthrough.indexedWithoutWeight",
  transport_invalid_pallet_count: "simulator.passthrough.invalidPallets",
  missing_pallet_qty: "simulator.passthrough.missingPalletQty",
  same_currency: "simulator.passthrough.sameCurrency",
  zero_customs_cost: "simulator.passthrough.zeroCustomsCost",
  zero_customs_rate: "simulator.passthrough.zeroCustomsRate",
  missing_total_quantity: "simulator.passthrough.missingTotalQty",
  no_customs_charge: "simulator.passthrough.noCustoms",
  not_synced_odoo: "simulator.passthrough.notSynced",
  no_stock_or_purchases: "simulator.passthrough.noStock",
};

/** EUR = 2 decimals for display; other currencies keep up to 4 (engine precision). */
function displayMoneyOptions(currency?: string | null): Intl.NumberFormatOptions {
  const c = String(currency ?? "")
    .toUpperCase()
    .replace("€", "EUR");
  if (c === "EUR") {
    return { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  }
  return { minimumFractionDigits: 2, maximumFractionDigits: 4 };
}

function fmtMoney(amount: unknown, currency?: string, locale = "fr"): string {
  if (amount == null || amount === "") return "—";
  const n = parseFloat(String(amount));
  if (!Number.isFinite(n)) return String(amount);
  const formatted = formatUiNumber(n, locale, displayMoneyOptions(currency));
  return currency ? `${formatted} ${currency}` : formatted;
}

function fmtDelta(input: BreakdownPrice, output: BreakdownPrice, locale: string): string | null {
  const inN = parseFloat(input.amount);
  const outN = parseFloat(output.amount);
  if (!Number.isFinite(inN) || !Number.isFinite(outN)) return null;
  const delta = outN - inN;
  if (delta === 0) return tr(locale, "simulator.breakdown.noAmountChange");
  const sign = delta > 0 ? "+" : "−";
  const formatted = formatUiNumber(Math.abs(delta), locale, displayMoneyOptions(output.currency));
  return tr(locale, "simulator.breakdown.amountDelta", {
    sign,
    amount: formatted,
    currency: output.currency,
  });
}

/** Human-readable, module-specific explanation lines (no raw engine keys). */
export function formatBreakdownStepDetails(
  step: BreakdownStep,
  options?: { transportLabels?: Record<string, string>; locale?: string },
): string[] {
  const locale = options?.locale ?? "fr";
  const money = (amount: unknown, currency?: string) => fmtMoney(amount, currency, locale);
  const num = (v?: string | null) => fmtNum(v, locale);
  const price = (v?: BreakdownPrice | null) => fmtPrice(v, locale);
  const meta = step.metadata ?? {};
  const lines: string[] = [];
  const labelTransport = (code: unknown) => {
    const c = String(code ?? "");
    return options?.transportLabels?.[c] ?? defaultTransportModeLabel(c, undefined, locale);
  };

  if (!step.applied) {
    const reason = String(meta.reason ?? "");
    const reasonKey = PASSTHROUGH_KEYS[reason];
    lines.push(reasonKey ? tr(locale, reasonKey) : tr(locale, "simulator.passthrough.skipped"));
    if (reason === "same_currency") {
      lines.push(
        tr(locale, "simulator.breakdown.priceCurrency", {
          currency: String(meta.currency ?? step.input_price.currency),
        }),
      );
    }
    if (reason === "missing_total_quantity") {
      lines.push(
        tr(locale, "simulator.breakdown.feesEntered", {
          amount: money(meta.global_cost, String(meta.global_cost_currency ?? "EUR")),
        }),
      );
      lines.push(tr(locale, "simulator.breakdown.missingQtyHint"));
    }
    return lines;
  }

  switch (step.module) {
    case "copper_variation": {
      const ccy = String(meta.copper_price_currency ?? "RMB");
      const poCcy = String(meta.po_currency ?? step.input_price.currency);
      lines.push(
        tr(locale, "simulator.breakdown.poPrice", { price: price(step.input_price) }),
      );
      lines.push(
        tr(locale, "simulator.breakdown.copperLme", {
          base: money(meta.copper_base, ccy),
          current: money(meta.copper_current, ccy),
        }),
      );
      lines.push(
        tr(locale, "simulator.breakdown.copperWeight", {
          weight: num(String(meta.copper_weight_kg)),
        }),
      );
      lines.push(
        tr(locale, "simulator.breakdown.copperVariation", {
          amount: money(meta.variation_rmb ?? meta.variation, ccy),
        }),
      );
      if (meta.fx_rmb_to_input && poCcy !== "RMB") {
        lines.push(
          tr(locale, "simulator.breakdown.copperFx", {
            currency: poCcy,
            rate: parseFloat(String(meta.fx_rmb_to_input)).toLocaleString(uiDateLocale(locale), {
              maximumFractionDigits: 6,
            }),
            amount: money(meta.variation, poCcy),
          }),
        );
      } else if (poCcy === "RMB") {
        lines.push(
          tr(locale, "simulator.breakdown.copperAdded", {
            amount: money(meta.variation, poCcy),
          }),
        );
      }
      break;
    }
    case "currency_conversion": {
      lines.push(
        tr(locale, "simulator.breakdown.fxConversion", {
          from: String(meta.from_currency ?? ""),
          to: String(meta.to_currency ?? ""),
          rate: parseFloat(String(meta.fx_rate)).toLocaleString(uiDateLocale(locale), {
            maximumFractionDigits: 6,
          }),
        }),
      );
      lines.push(
        tr(locale, "simulator.breakdown.fxResult", {
          input: money(step.input_price.amount, step.input_price.currency),
          output: price(step.output_price),
        }),
      );
      break;
    }
    case "transport": {
      if (meta.mode === "coefficient") {
        lines.push(
          tr(locale, "simulator.breakdown.coefficientMode", {
            coefficient: String(meta.coefficient ?? ""),
          }),
        );
        if (meta.transport_mode) {
          lines.push(
            tr(locale, "simulator.breakdown.transportMode", {
              mode: labelTransport(meta.transport_mode),
            }),
          );
        }
      } else {
        const gcc = String(meta.global_cost_currency ?? step.input_price.currency);
        let globalCost = tr(locale, "simulator.breakdown.transportGlobal", {
          cost: money(meta.global_cost, gcc),
        });
        if (meta.from_location || meta.to_location) {
          globalCost += ` (${[meta.from_location, meta.to_location].filter(Boolean).join(" → ")})`;
        }
        if (meta.transport_mode) {
          globalCost += ` — ${labelTransport(meta.transport_mode)}`;
        }
        lines.push(`${globalCost}.`);
        lines.push(
          tr(locale, "simulator.breakdown.transportSplit", {
            cost: money(meta.global_cost, gcc),
            pallets: String(meta.pallet_count ?? ""),
            perPallet: money(meta.cost_per_pallet, gcc),
          }),
        );
        lines.push(
          tr(locale, "simulator.breakdown.transportUnit", {
            perPallet: money(meta.cost_per_pallet, gcc),
            qty: String(meta.pallet_qty ?? ""),
            perUnit: money(
              meta.cost_per_unit,
              String(meta.cost_per_unit_currency ?? step.input_price.currency),
            ),
          }),
        );
        if (meta.fx_transport_to_input) {
          lines.push(
            tr(locale, "simulator.breakdown.transportFx", {
              currency: step.input_price.currency,
              rate: parseFloat(String(meta.fx_transport_to_input)).toLocaleString(uiDateLocale(locale), {
                maximumFractionDigits: 6,
              }),
            }),
          );
        }
        lines.push(
          tr(locale, "simulator.breakdown.transportTotal", {
            price: price(step.output_price),
          }),
        );
      }
      break;
    }
    case "customs": {
      if (meta.mode === "coefficient") {
        lines.push(
          tr(locale, "simulator.breakdown.customsCoefficient", {
            coefficient: String(meta.coefficient ?? ""),
          }),
        );
      } else if (meta.mode === "percentage") {
        lines.push(
          tr(locale, "simulator.breakdown.customsRate", { rate: String(meta.rate_pct ?? "") }),
        );
        lines.push(
          tr(locale, "simulator.breakdown.customsDuty", {
            input: money(step.input_price.amount, step.input_price.currency),
            rate: String(meta.rate_pct ?? ""),
            duty: money(meta.duty_amount, String(meta.duty_currency ?? step.input_price.currency)),
          }),
        );
        lines.push(
          tr(locale, "simulator.breakdown.customsAfter", { price: price(step.output_price) }),
        );
      } else {
        const gcc = String(meta.global_cost_currency ?? step.input_price.currency);
        lines.push(
          tr(locale, "simulator.breakdown.customsLegacy", {
            cost: money(meta.global_cost, gcc),
          }),
        );
        lines.push(
          tr(locale, "simulator.breakdown.customsSplit", {
            cost: money(meta.global_cost, gcc),
            qty: num(String(meta.total_quantity)),
            perUnit: money(meta.cost_per_unit, step.input_price.currency),
          }),
        );
      }
      break;
    }
    case "margin":
    case "syskern_margin":
    case "symea_margin": {
      const label =
        step.module === "syskern_margin" || meta.label === "syskern"
          ? tr(locale, "simulator.module.syskern")
          : step.module === "symea_margin" || meta.label === "symea"
            ? tr(locale, "simulator.module.symea")
            : tr(locale, "simulator.module.margin");
      const pct = decToPct(String(meta.rate));
      lines.push(tr(locale, "simulator.breakdown.marginLine", { label, pct }));
      lines.push(
        tr(locale, "simulator.breakdown.marginFormula", {
          pct,
          input: money(step.input_price.amount, step.input_price.currency),
          rate: parseFloat(String(meta.rate)).toLocaleString(uiDateLocale(locale), { maximumFractionDigits: 4 }),
          output: price(step.output_price),
        }),
      );
      if (meta.margin_amount) {
        lines.push(
          tr(locale, "simulator.breakdown.marginAdded", {
            amount: money(meta.margin_amount, step.output_price.currency),
          }),
        );
      }
      break;
    }
    case "predictive_pamp": {
      lines.push(
        tr(locale, "simulator.breakdown.stockNow", {
          qty: num(String(meta.stock_quantity)),
          pamp: money(meta.pamp_eur, "EUR"),
          value: money(meta.stock_value_eur, "EUR"),
        }),
      );
      const pending = Array.isArray(meta.pending_purchases) ? meta.pending_purchases : [];
      if (pending.length > 0) {
        lines.push(tr(locale, "simulator.breakdown.pendingPurchases", { count: pending.length }));
        for (const row of pending) {
          const r = row as { quantity?: string; price_unit_eur?: string };
          lines.push(
            tr(locale, "simulator.breakdown.pendingRow", {
              qty: num(String(r.quantity ?? "0")),
              price: money(r.price_unit_eur, "EUR"),
              value: money(
                parseFloat(String(r.quantity ?? "0")) * parseFloat(String(r.price_unit_eur ?? "0")),
                "EUR",
              ),
            }),
          );
        }
        lines.push(
          tr(locale, "simulator.breakdown.purchaseValue", {
            amount: money(meta.purchase_value_eur, "EUR"),
          }),
        );
      } else {
        lines.push(tr(locale, "simulator.breakdown.noPending"));
      }
      lines.push(
        tr(locale, "simulator.breakdown.pampFormula", {
          stock: money(meta.stock_value_eur, "EUR"),
          purchases: money(meta.purchase_value_eur, "EUR"),
          qty: num(String(meta.total_quantity)),
          output: price(step.output_price),
        }),
      );
      break;
    }
    case "pr_mix": {
      const effective = meta.effective_mix_pct ?? meta.stock_weight_pct ?? 0;
      const purchaseWeight = meta.purchase_weight_pct ?? 100 - Number(effective);
      const stockWeight = meta.stock_weight_pct ?? effective;
      lines.push(
        tr(locale, "simulator.breakdown.mixLine", {
          mix: String(meta.simulation_mix_pct ?? "—"),
        }) +
          (meta.line_override != null
            ? tr(locale, "simulator.breakdown.mixOverride", { value: String(meta.line_override) })
            : "") +
          tr(locale, "simulator.breakdown.mixEffective", {
            requested: String(meta.requested_mix_pct ?? effective),
            effective: String(effective),
          }),
      );
      lines.push(
        tr(locale, "simulator.breakdown.mixSplit", {
          purchase: String(purchaseWeight),
          stock: String(stockWeight),
        }),
      );
      if (meta.pamp_predictive_eur == null) {
        lines.push(tr(locale, "simulator.breakdown.pampUnavailable"));
      } else {
        lines.push(
          tr(locale, "simulator.breakdown.paAndPamp", {
            pa: money(meta.pa_net_eur, "EUR"),
            pamp: money(meta.pamp_predictive_eur, "EUR"),
          }),
        );
        lines.push(
          tr(locale, "simulator.breakdown.prFormula", {
            purchase: String(purchaseWeight),
            stock: String(stockWeight),
          }) +
            (meta.weighted_pa_component && meta.weighted_pamp_component
              ? tr(locale, "simulator.breakdown.prWeighted", {
                  pa: money(meta.weighted_pa_component, "EUR"),
                  pamp: money(meta.weighted_pamp_component, "EUR"),
                })
              : "") +
            tr(locale, "simulator.breakdown.prResult", { price: price(step.output_price) }),
        );
      }
      break;
    }
    default:
      break;
  }

  const delta = fmtDelta(step.input_price, step.output_price, locale);
  if (delta && !["margin", "syskern_margin", "symea_margin"].includes(step.module)) {
    lines.push(delta);
  }

  return lines;
}

export interface BreakdownPrice {
  amount: string;
  currency: string;
}

export interface BreakdownStep {
  module: string;
  order: number | null;
  applied: boolean;
  input_price: BreakdownPrice;
  output_price: BreakdownPrice;
  metadata: Record<string, unknown>;
  warnings: string[];
}

export interface BreakdownChain {
  steps: BreakdownStep[];
  warnings: string[];
  final_amount?: string;
  final_currency?: string;
}

export interface LineBreakdown {
  purchase?: BreakdownChain;
  pr?: BreakdownChain;
  sale?: BreakdownChain;
  mix_pct?: number;
  requested_mix_pct?: number;
  syskern_margin_rate?: string;
  market_params_snapshot?: Record<string, string | number>;
  incoterm_context?: {
    sale_incoterm?: string;
    sale_incoterm_location?: string;
    purchase_incoterm?: string;
    purchase_incoterm_location?: string;
  };
  warnings?: string[];
  errors?: string[];
  error?: string;
}

export function parseLineBreakdown(line: SimulationLine): LineBreakdown {
  return (line.calculation_breakdown ?? {}) as LineBreakdown;
}

/** PR chain steps from persisted breakdown, with a lightweight fallback for older lines. */
export function prChainSteps(line: SimulationLine, breakdown: LineBreakdown): BreakdownStep[] {
  const persisted = breakdown.pr?.steps ?? [];
  if (persisted.length > 0) return persisted;

  const mixPct = breakdown.mix_pct ?? line.effective_mix_pct ?? 0;
  const purchaseWeight = 100 - mixPct;
  const paAmount = line.pa_net_eur ?? "0";
  const prAmount = line.pr_eur ?? paAmount;
  const eur = "EUR";
  const steps: BreakdownStep[] = [];

  if (line.pamp_predictive_eur) {
    steps.push({
      module: "predictive_pamp",
      order: 1,
      applied: true,
      input_price: { amount: line.pamp_predictive_eur, currency: eur },
      output_price: { amount: line.pamp_predictive_eur, currency: eur },
      metadata: { pamp_predictive_eur: line.pamp_predictive_eur },
      warnings: [],
    });
  } else {
    steps.push({
      module: "predictive_pamp",
      order: 1,
      applied: false,
      input_price: { amount: paAmount, currency: eur },
      output_price: { amount: paAmount, currency: eur },
      metadata: { reason: "unavailable" },
      warnings: [],
    });
  }

  steps.push({
    module: "pr_mix",
    order: 2,
    applied: true,
    input_price: { amount: paAmount, currency: eur },
    output_price: { amount: prAmount, currency: eur },
    metadata: {
      simulation_mix_pct: mixPct,
      line_override: line.stock_purchase_mix_pct_override,
      requested_mix_pct: breakdown.requested_mix_pct ?? mixPct,
      effective_mix_pct: mixPct,
      purchase_weight_pct: purchaseWeight,
      stock_weight_pct: mixPct,
      pa_net_eur: paAmount,
      pamp_predictive_eur: line.pamp_predictive_eur,
    },
    warnings: [],
  });

  return steps;
}

export function moduleLabel(module: string, locale = "fr"): string {
  const key = MODULE_LABEL_KEYS[module];
  return key ? translate(key, locale) : module;
}

/** Step title in breakdown — distinguishes Syskern vs Symea margin modules. */
export function stepModuleLabel(step: BreakdownStep, locale = "fr"): string {
  if (step.module === "syskern_margin") return moduleLabel("syskern_margin", locale);
  if (step.module === "symea_margin") return moduleLabel("symea_margin", locale);
  if (step.module === "margin") {
    const label = step.metadata?.label;
    if (label === "syskern") return moduleLabel("syskern_margin", locale);
    if (label === "symea") return moduleLabel("symea_margin", locale);
  }
  return moduleLabel(step.module, locale);
}

/** Format a price from the breakdown (amount + currency). */
export function fmtPrice(price?: BreakdownPrice | null, locale = "fr"): string {
  if (!price?.amount) return "—";
  const n = parseFloat(price.amount);
  if (!Number.isFinite(n)) return "—";
  const formatted = formatUiNumber(n, locale, displayMoneyOptions(price.currency));
  return `${formatted} ${price.currency ?? ""}`.trim();
}

export const RECALC_TRIGGER: Record<string, { badge: string }> = {
  manual_current_params: {
    badge: "border border-primary/20 bg-primary/10 text-primary",
  },
  manual_refresh_odoo: {
    badge: "border border-secondary bg-secondary/50 text-secondary-foreground",
  },
  manual_full_refresh: {
    badge: "border border-primary/30 bg-accent text-accent-foreground",
  },
  line_recalculate: {
    badge: "bg-muted text-muted-foreground",
  },
  initial: {
    badge: "bg-muted text-foreground",
  },
};

const RECALC_TRIGGER_KEYS: Record<string, MessageKey> = {
  manual_current_params: "simulator.recalc.current",
  manual_refresh_odoo: "simulator.recalc.odoo",
  manual_full_refresh: "simulator.recalc.full",
  line_recalculate: "simulator.recalc.line",
  initial: "simulator.recalc.initial",
};

/** Label for a recalculation trigger — never expose raw `trigger_type` in the UI. */
export function recalcTriggerLabel(triggerType: string | null | undefined, locale = "fr"): string {
  if (!triggerType) return "—";
  const key = RECALC_TRIGGER_KEYS[triggerType];
  return key ? translate(key, locale) : translate("simulator.recalc.fallback", locale);
}

/** True when the persisted sale breakdown still applies Syskern margin after PV transports. */
export function isStaleSaleMarginBreakdown(breakdown: LineBreakdown): boolean {
  const steps = breakdown.sale?.steps ?? [];
  if (steps.length < 2) return false;
  const marginIdx = steps.findIndex(
    (s) =>
      s.module === "syskern_margin" ||
      (s.module === "margin" && s.metadata?.label === "syskern"),
  );
  const transportIdx = steps.findIndex((s) => s.module === "transport");
  if (marginIdx < 0 || transportIdx < 0) return false;
  return marginIdx > transportIdx;
}

/** Keep long engine messages inside drawers and wizard panels (wrap + no horizontal spill). */
export const diagnosticTextClass =
  "min-w-0 max-w-full break-words [overflow-wrap:anywhere]";
