import type { SimulationLine, SimulationLineStatus } from "@/lib/api";
import { transportModeLabel as defaultTransportModeLabel } from "@/lib/transport-modes";

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
  const errors = Array.isArray(b.errors) ? b.errors.map(String) : [];
  const warnings = Array.isArray(b.warnings) ? b.warnings.map(String) : [];
  if (typeof b.error === "string" && b.error && !errors.includes(b.error)) {
    errors.unshift(b.error);
  }
  return { errors, warnings };
}

/** Context when opening a product fiche from a simulation line. */
export interface ProductEditFromSimulation {
  simulationId: string;
  simulationLabel: string;
}

/** Deep-link to the product fiche in edit mode, optionally opening a relevant tab. */
export function productEditHref(
  sku: string,
  messages: string[] = [],
  fromSimulation?: ProductEditFromSimulation
): string {
  const q = new URLSearchParams({ edit: "1" });
  const joined = messages.join(" ").toLowerCase();
  if (joined.includes("pallet_qty") || joined.includes("palette")) {
    q.set("tab", "logistics");
  } else if (joined.includes("prix d'achat") || joined.includes("(po)")) {
    q.set("tab", "commercial");
  }
  if (fromSimulation) {
    q.set("from", "simulation");
    q.set("simulation_id", fromSimulation.simulationId);
    q.set("simulation_label", fromSimulation.simulationLabel);
  }
  return `/catalog/${encodeURIComponent(sku)}?${q.toString()}`;
}

/** Format a Decimal-string money value as EUR for display (never for math). */
export function fmtEur(v?: string | null): string {
  if (v == null || v === "") return "—";
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return "—";
  return `${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

/** Format a plain number-ish string (e.g. stock) for display. */
export function fmtNum(v?: string | null): string {
  if (v == null || v === "") return "—";
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
}

/** Decimal rate string ("0.0600") → percent display string ("6"). */
export function decToPct(v?: string | null): string {
  if (v == null || v === "") return "";
  const n = parseFloat(v);
  return Number.isFinite(n) ? String(Math.round(n * 10000) / 100) : "";
}

export const LINE_STATUS: Record<SimulationLineStatus, { badge: string; row: string; label: string }> = {
  ok: { badge: "border border-primary/20 bg-primary/10 text-primary", row: "", label: "OK" },
  pending: { badge: "bg-muted text-muted-foreground", row: "", label: "En attente" },
  warning: { badge: "border border-warm/30 bg-warm/10 text-warm", row: "bg-warm/5", label: "Avertissement" },
  error: { badge: "bg-destructive/10 text-destructive", row: "bg-destructive/5", label: "Erreur" },
  dirty: { badge: "border border-data-dirty/30 bg-data-dirty/10 text-data-dirty", row: "bg-data-dirty/10", label: "Modifié" },
};

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
export const MODULE_LABELS: Record<string, string> = {
  copper_variation: "Variation cuivre",
  currency_conversion: "Conversion devise",
  transport: "Transport",
  customs: "Douane",
  symea_margin: "Marge Symea",
  syskern_margin: "Marge Syskern",
  margin: "Marge",
};

/** Passthrough reasons stored in step metadata when a module is skipped. */
export const PASSTHROUGH_REASONS: Record<string, string> = {
  not_applicable: "Produit non indexé cuivre — étape ignorée.",
  indexed_without_weight: "Produit indexé cuivre sans poids déclaré — variation ignorée.",
  transport_invalid_pallet_count: "Nombre de palettes du transport invalide (≤ 0) — coût ignoré.",
  missing_pallet_qty: "Quantité par palette du produit manquante — coût transport ignoré.",
  same_currency: "Le prix est déjà dans la devise cible — aucune conversion.",
  zero_customs_cost: "Aucun frais de douane renseigné (montant à 0).",
  zero_customs_rate: "Taux de douane à 0 % — étape ignorée.",
  missing_total_quantity:
    "Frais de douane renseignés mais quantité totale absente — impossible de répartir par unité.",
  no_customs_charge: "Aucun frais de douane applicable.",
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

function fmtMoney(amount: unknown, currency?: string): string {
  if (amount == null || amount === "") return "—";
  const n = parseFloat(String(amount));
  if (!Number.isFinite(n)) return String(amount);
  const formatted = n.toLocaleString("fr-FR", displayMoneyOptions(currency));
  return currency ? `${formatted} ${currency}` : formatted;
}

function fmtDelta(input: BreakdownPrice, output: BreakdownPrice): string | null {
  const inN = parseFloat(input.amount);
  const outN = parseFloat(output.amount);
  if (!Number.isFinite(inN) || !Number.isFinite(outN)) return null;
  const delta = outN - inN;
  if (delta === 0) return "Aucun changement de montant.";
  const sign = delta > 0 ? "+" : "−";
  const formatted = Math.abs(delta).toLocaleString("fr-FR", displayMoneyOptions(output.currency));
  return `Variation : ${sign}${formatted} ${output.currency}`;
}

/** Human-readable, module-specific explanation lines (no raw engine keys). */
export function formatBreakdownStepDetails(
  step: BreakdownStep,
  options?: { transportLabels?: Record<string, string> }
): string[] {
  const meta = step.metadata ?? {};
  const lines: string[] = [];
  const labelTransport = (code: unknown) => {
    const c = String(code ?? "");
    return options?.transportLabels?.[c] ?? defaultTransportModeLabel(c);
  };

  if (!step.applied) {
    const reason = String(meta.reason ?? "");
    lines.push(PASSTHROUGH_REASONS[reason] ?? "Étape ignorée.");
    if (reason === "same_currency") {
      lines.push(`Devise du prix : ${meta.currency ?? step.input_price.currency}.`);
    }
    if (reason === "missing_total_quantity") {
      lines.push(
        `Frais saisis : ${fmtMoney(meta.global_cost, String(meta.global_cost_currency ?? "EUR"))}.`
      );
      lines.push(
        "Renseignez « Quantité totale (unités) » dans la section Douane de la chaîne de calcul, puis recalculez."
      );
    }
    return lines;
  }

  switch (step.module) {
    case "copper_variation": {
      const ccy = String(meta.copper_price_currency ?? "RMB");
      const poCcy = String(meta.po_currency ?? step.input_price.currency);
      lines.push(
        `Prix PO fournisseur (entrée) : ${fmtPrice(step.input_price)} — devise fournisseur, distincte du cours cuivre.`
      );
      lines.push(
        `Cours cuivre LME (paramètres marché) : ${fmtMoney(meta.copper_base, ccy)} (base) → ${fmtMoney(meta.copper_current, ccy)} (actuel).`
      );
      lines.push(`Poids cuivre du produit : ${fmtNum(String(meta.copper_weight_kg))} kg / unité.`);
      lines.push(
        `Variation cuivre = (actuel − base) × poids ÷ 1 000 = ${fmtMoney(meta.variation_rmb ?? meta.variation, ccy)}.`
      );
      if (meta.fx_rmb_to_input && poCcy !== "RMB") {
        lines.push(
          `Conversion de la variation en ${poCcy} (taux RMB→${poCcy} : ${parseFloat(String(meta.fx_rmb_to_input)).toLocaleString("fr-FR", { maximumFractionDigits: 6 })}) : ${fmtMoney(meta.variation, poCcy)} ajoutés au prix PO.`
        );
      } else if (poCcy === "RMB") {
        lines.push(`Montant ajouté au prix PO : ${fmtMoney(meta.variation, poCcy)}.`);
      }
      break;
    }
    case "currency_conversion": {
      lines.push(
        `Conversion ${meta.from_currency} → ${meta.to_currency} au taux ${parseFloat(String(meta.fx_rate)).toLocaleString("fr-FR", { maximumFractionDigits: 6 })}.`
      );
      lines.push(
        `${fmtMoney(step.input_price.amount, step.input_price.currency)} × taux = ${fmtPrice(step.output_price)}.`
      );
      break;
    }
    case "transport": {
      if (meta.mode === "coefficient") {
        lines.push(`Mode coefficient : prix × ${meta.coefficient}.`);
        if (meta.transport_mode) {
          lines.push(`Transport : ${labelTransport(meta.transport_mode)}.`);
        }
      } else {
        const gcc = String(meta.global_cost_currency ?? step.input_price.currency);
        lines.push(
          `Coût global transport : ${fmtMoney(meta.global_cost, gcc)}` +
            (meta.from_location || meta.to_location
              ? ` (${[meta.from_location, meta.to_location].filter(Boolean).join(" → ")})`
              : "") +
            (meta.transport_mode
              ? ` — ${labelTransport(meta.transport_mode)}`
              : "") +
            "."
        );
        lines.push(
          `Répartition : ${fmtMoney(meta.global_cost, gcc)} ÷ ${meta.pallet_count} palette(s) = ${fmtMoney(meta.cost_per_pallet, gcc)} / palette.`
        );
        lines.push(
          `${fmtMoney(meta.cost_per_pallet, gcc)} ÷ ${meta.pallet_qty} unité(s)/palette = ${fmtMoney(meta.cost_per_unit, String(meta.cost_per_unit_currency ?? step.input_price.currency))} / unité.`
        );
        if (meta.fx_transport_to_input) {
          lines.push(
            `Conversion devise transport → ${step.input_price.currency} (taux ${parseFloat(String(meta.fx_transport_to_input)).toLocaleString("fr-FR", { maximumFractionDigits: 6 })}).`
          );
        }
        lines.push(
          `Prix unitaire + coût transport/unité = ${fmtPrice(step.output_price)}.`
        );
      }
      break;
    }
    case "customs": {
      if (meta.mode === "coefficient") {
        lines.push(`Mode coefficient douane : prix × ${meta.coefficient}.`);
      } else if (meta.mode === "percentage") {
        lines.push(`Taux de douane : ${meta.rate_pct} % du prix d'entrée.`);
        lines.push(
          `${fmtMoney(step.input_price.amount, step.input_price.currency)} × ${meta.rate_pct} % = ${fmtMoney(meta.duty_amount, String(meta.duty_currency ?? step.input_price.currency))} de droits ajoutés.`
        );
        lines.push(`Prix après douane : ${fmtPrice(step.output_price)}.`);
      } else {
        const gcc = String(meta.global_cost_currency ?? step.input_price.currency);
        lines.push(`Frais de douane globaux (mode legacy) : ${fmtMoney(meta.global_cost, gcc)}.`);
        lines.push(
          `Répartition : ${fmtMoney(meta.global_cost, gcc)} ÷ ${fmtNum(String(meta.total_quantity))} unité(s) = ${fmtMoney(meta.cost_per_unit, step.input_price.currency)} / unité ajouté au prix.`
        );
      }
      break;
    }
    case "margin": {
      const label =
        meta.label === "symea"
          ? "Marge Symea"
          : meta.label === "syskern"
            ? "Marge Syskern"
            : "Marge";
      const pct = decToPct(String(meta.rate));
      lines.push(`${label} : ${pct} % (sur le prix de vente).`);
      lines.push(
        `Formule : prix de vente = prix d'achat ÷ (1 − ${pct} %) = ${fmtMoney(step.input_price.amount, step.input_price.currency)} ÷ (1 − ${parseFloat(String(meta.rate)).toLocaleString("fr-FR", { maximumFractionDigits: 4 })}) = ${fmtPrice(step.output_price)}.`
      );
      if (meta.margin_amount) {
        lines.push(`Marge ajoutée : ${fmtMoney(meta.margin_amount, step.output_price.currency)}.`);
      }
      break;
    }
    default:
      break;
  }

  const delta = fmtDelta(step.input_price, step.output_price);
  if (delta && step.module !== "margin") lines.push(delta);

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
  sale?: BreakdownChain;
  mix_pct?: number;
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

export function moduleLabel(module: string): string {
  return MODULE_LABELS[module] ?? module;
}

/** Format a price from the breakdown (amount + currency). */
export function fmtPrice(price?: BreakdownPrice | null): string {
  if (!price?.amount) return "—";
  const n = parseFloat(price.amount);
  if (!Number.isFinite(n)) return "—";
  const formatted = n.toLocaleString("fr-FR", displayMoneyOptions(price.currency));
  return `${formatted} ${price.currency ?? ""}`.trim();
}

export const RECALC_TRIGGER: Record<string, { label: string; badge: string }> = {
  manual_current_params: {
    label: "Paramètres actuels",
    badge: "border border-primary/20 bg-primary/10 text-primary",
  },
  manual_refresh_odoo: {
    label: "Refresh Odoo",
    badge: "border border-secondary bg-secondary/50 text-secondary-foreground",
  },
  manual_full_refresh: {
    label: "Refresh complet",
    badge: "border border-primary/30 bg-accent text-accent-foreground",
  },
  line_recalculate: {
    label: "Ligne unique",
    badge: "bg-muted text-muted-foreground",
  },
  initial: {
    label: "Calcul initial",
    badge: "bg-muted text-foreground",
  },
};

/** French label for a recalculation trigger — never expose raw `trigger_type` in the UI. */
export function recalcTriggerLabel(triggerType: string | null | undefined): string {
  if (!triggerType) return "—";
  return RECALC_TRIGGER[triggerType]?.label ?? "Recalcul";
}
