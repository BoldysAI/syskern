import type { CompareColumn } from "@/lib/api";
import { decToPct, fmtEur, mpStr, recalcTriggerLabel } from "@/app/simulator/[id]/_components/sim-format";
import { formatUiDateTime, formatUiNumber, translate, type MessageKey } from "@/lib/i18n";
import { formatIncotermDisplay } from "@/lib/incoterms";

export type DiffKind = "same" | "changed" | "added" | "missing";

export interface DiffRow {
  id: string;
  label: string;
  /** Display string per column key. */
  values: Record<string, string>;
  /** Whether this row differs from the reference column. */
  hasDiff: boolean;
  deltaUnit?: "eur" | "pct" | "raw";
}

/** Normalize a display value for equality checks. */
export function normVal(v: string | null | undefined): string {
  if (v == null || v === "" || v === "—") return "";
  return v.trim();
}

export function diffKind(ref: string, val: string): DiffKind {
  const r = normVal(ref);
  const v = normVal(val);
  if (!v && r) return "missing";
  if (v && !r) return "added";
  if (v === r) return "same";
  return "changed";
}

/**
 * Parse a string this UI just displayed (e.g. "317,51 €" or "1,234.56 €").
 * The locale is the viewer's display locale, never the locale of an imported file.
 */
export function parseLocaleNum(v: string, locale = "fr"): number | null {
  const trimmed = v.trim();
  if (!trimmed || trimmed === "—") return null;
  let s = trimmed
    .replace(/\u202f/g, "")
    .replace(/\s/g, "")
    .replace(/€/g, "")
    .replace(/%/g, "")
    .trim();
  if (!s) return null;
  if (locale === "en") {
    s = s.replace(/,/g, "");
  } else if (s.includes(",")) {
    s = s.includes(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(",", ".");
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

export function parseNum(v: string, locale = "fr"): number | null {
  return parseLocaleNum(v, locale);
}

/** Format numeric delta for display (EUR or %). */
export function fmtDelta(
  ref: string,
  val: string,
  unit: "eur" | "pct" | "raw" = "raw",
  locale = "fr",
): string | null {
  const r = parseNum(ref, locale);
  const v = parseNum(val, locale);
  if (r == null || v == null || r === v) return null;
  const d = v - r;
  if (unit === "eur") {
    const sign = d >= 0 ? "+" : "−";
    return `${sign}${fmtEur(Math.abs(d).toFixed(4), locale)}`;
  }
  if (unit === "pct") {
    const sign = d >= 0 ? "+" : "−";
    return translate("simulator.compare.deltaPts", locale, {
      value: `${sign}${Math.abs(d).toFixed(2)}`,
    });
  }
  const sign = d >= 0 ? "+" : "−";
  return `${sign}${formatUiNumber(Math.abs(d), locale, { maximumFractionDigits: 4 })}`;
}

const SYMEA_POS: Record<string, MessageKey> = {
  after_transports: "simulator.position.after",
  before_transports: "simulator.position.before",
};

const SIM_TYPE: Record<string, MessageKey> = {
  tariff: "simulator.type.tariff",
  project: "simulator.type.project",
};

const STATUS: Record<string, MessageKey> = {
  draft: "simulator.status.draft",
  finalized: "simulator.status.finalizedFem",
  archived: "simulator.status.archivedFem",
};

function fmtDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return "—";
  return formatUiDateTime(iso, locale);
}

function colContextValue(col: CompareColumn, fieldId: string, locale: string): string {
  const ctx = col.context;
  const mp = ctx.market_params;
  const agg = col.aggregates;

  switch (fieldId) {
    case "type":
      return col.type === "recalculation"
        ? translate("simulator.compare.snapshotRecalc", locale)
        : SIM_TYPE[ctx.simulation_type ?? ""]
          ? translate(SIM_TYPE[ctx.simulation_type ?? ""], locale)
          : "—";
    case "status":
      return col.status
        ? STATUS[col.status]
          ? translate(STATUS[col.status], locale)
          : "—"
        : "—";
    case "calculated_at":
      return fmtDate(ctx.calculated_at, locale);
    case "odoo_snapshot_at":
      return fmtDate(ctx.odoo_snapshot_at, locale);
    case "trigger":
      return recalcTriggerLabel(ctx.trigger_type, locale);
    case "copper_base":
      return mpStr(mp, "copper_base_price_rmb");
    case "copper_current":
      return mpStr(mp, "copper_current_price_rmb");
    case "fx_eur_rmb":
      return mpStr(mp, "fx_eur_rmb");
    case "fx_eur_usd":
      return mpStr(mp, "fx_eur_usd");
    case "mix":
      return `${ctx.stock_purchase_mix_pct} %`;
    case "margin_syskern":
      return decToPct(ctx.syskern_margin_rate) ? `${decToPct(ctx.syskern_margin_rate)} %` : "—";
    case "margin_symea":
      return decToPct(ctx.symea_margin_rate) ? `${decToPct(ctx.symea_margin_rate)} %` : "—";
    case "symea_position":
      return SYMEA_POS[ctx.symea_margin_position]
        ? translate(SYMEA_POS[ctx.symea_margin_position], locale)
        : "—";
    case "sale_incoterm":
      return formatIncotermDisplay(ctx.sale_incoterm ?? "EXW", ctx.sale_incoterm_location);
    case "chain_modules":
      return ctx.chain_module_count > 0
        ? translate(
            ctx.chain_module_count > 1
              ? "simulator.compare.moduleOther"
              : "simulator.compare.moduleOne",
            locale,
            { count: ctx.chain_module_count },
          )
        : "—";
    case "note":
      return ctx.note ?? "—";
    case "agg_lines":
      return agg.line_count != null ? String(agg.line_count) : "—";
    case "agg_avg_pa":
      return fmtEur(agg.avg_pa_eur, locale);
    case "agg_avg_pr":
      return fmtEur(agg.avg_pr_eur, locale);
    case "agg_avg_pv":
      return fmtEur(agg.avg_pv_eur, locale);
    case "agg_avg_margin":
      return agg.avg_margin ? `${decToPct(agg.avg_margin)} %` : "—";
    case "agg_min_pv":
      return fmtEur(agg.min_pv_eur, locale);
    case "agg_max_pv":
      return fmtEur(agg.max_pv_eur, locale);
    case "agg_warnings":
      return agg.warnings_count != null ? String(agg.warnings_count) : "0";
    case "agg_errors":
      return agg.errors_count != null ? String(agg.errors_count) : "0";
    default:
      return "—";
  }
}

interface FieldDef {
  id: string;
  label: MessageKey;
  deltaUnit?: "eur" | "pct" | "raw";
}

const SECTIONS: { title: MessageKey; fields: FieldDef[] }[] = [
  {
    title: "simulator.compare.identity",
    fields: [
      { id: "type", label: "simulator.column.type" },
      { id: "status", label: "simulator.column.status" },
      { id: "calculated_at", label: "simulator.column.lastCalc" },
      { id: "odoo_snapshot_at", label: "simulator.history.snapshotOdoo" },
      { id: "trigger", label: "simulator.compare.trigger" },
      { id: "note", label: "simulator.compare.noteField" },
    ],
  },
  {
    title: "simulator.compare.marketSection",
    fields: [
      { id: "copper_base", label: "simulator.market.copperBaseRmb", deltaUnit: "raw" },
      { id: "copper_current", label: "simulator.market.copperCurrentRmb", deltaUnit: "raw" },
      { id: "fx_eur_rmb", label: "simulator.fx.eurToRmbSpaced", deltaUnit: "raw" },
      { id: "fx_eur_usd", label: "simulator.fx.eurToUsdSpaced", deltaUnit: "raw" },
    ],
  },
  {
    title: "simulator.compare.simSection",
    fields: [
      { id: "mix", label: "simulator.compare.mixStock", deltaUnit: "pct" },
      { id: "margin_syskern", label: "simulator.compare.marginSyskern", deltaUnit: "pct" },
      { id: "margin_symea", label: "simulator.compare.marginSymea", deltaUnit: "pct" },
      { id: "symea_position", label: "simulator.compare.symeaPosition" },
      { id: "sale_incoterm", label: "simulator.params.saleIncotermShort" },
      { id: "chain_modules", label: "simulator.compare.chain" },
    ],
  },
  {
    title: "simulator.compare.aggregates",
    fields: [
      { id: "agg_lines", label: "simulator.column.lines" },
      { id: "agg_avg_pa", label: "simulator.history.paAvg", deltaUnit: "eur" },
      { id: "agg_avg_pr", label: "simulator.history.prAvg", deltaUnit: "eur" },
      { id: "agg_avg_pv", label: "simulator.history.pvAvg", deltaUnit: "eur" },
      { id: "agg_avg_margin", label: "simulator.compare.marginAverage", deltaUnit: "pct" },
      { id: "agg_min_pv", label: "simulator.history.pvMin", deltaUnit: "eur" },
      { id: "agg_max_pv", label: "simulator.history.pvMax", deltaUnit: "eur" },
      { id: "agg_warnings", label: "simulator.status.warnings" },
      { id: "agg_errors", label: "simulator.status.errors" },
    ],
  },
];

export function buildDiffSections(
  columns: CompareColumn[],
  locale = "fr",
): { title: string; rows: DiffRow[] }[] {
  const baseKey = columns[0]?.key;
  return SECTIONS.map((section) => ({
    title: translate(section.title, locale),
    rows: section.fields.map((field) => {
      const values: Record<string, string> = {};
      for (const col of columns) {
        values[col.key] = colContextValue(col, field.id, locale);
      }
      const ref = baseKey ? values[baseKey] : "";
      const hasDiff = columns.some(
        (c) => c.key !== baseKey && diffKind(ref, values[c.key]) !== "same"
      );
      return {
        id: field.id,
        label: translate(field.label, locale),
        values,
        hasDiff,
        deltaUnit: field.deltaUnit,
      };
    }),
  }));
}

/** Count rows that differ from reference across all sections. */
export function countDiffs(sections: { rows: DiffRow[] }[]): number {
  return sections.reduce((n, s) => n + s.rows.filter((r) => r.hasDiff).length, 0);
}
