import type { CompareColumn } from "@/lib/api";
import { decToPct, fmtEur, mpStr, recalcTriggerLabel } from "@/app/simulator/[id]/_components/sim-format";
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

/** Parse a French-locale display string (e.g. "317,51 €", "20 %") to a number. */
export function parseLocaleNum(v: string): number | null {
  const trimmed = v.trim();
  if (!trimmed || trimmed === "—") return null;
  let s = trimmed
    .replace(/\u202f/g, "")
    .replace(/\s/g, "")
    .replace(/€/g, "")
    .replace(/%/g, "")
    .trim();
  if (!s) return null;
  if (s.includes(",")) {
    // "1.234,56" or "317,51"
    s = s.includes(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(",", ".");
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

export function parseNum(v: string): number | null {
  return parseLocaleNum(v);
}

/** Format numeric delta for display (EUR or %). */
export function fmtDelta(ref: string, val: string, unit: "eur" | "pct" | "raw" = "raw"): string | null {
  const r = parseNum(ref);
  const v = parseNum(val);
  if (r == null || v == null || r === v) return null;
  const d = v - r;
  if (unit === "eur") {
    const sign = d >= 0 ? "+" : "−";
    return `${sign}${fmtEur(Math.abs(d).toFixed(4))}`;
  }
  if (unit === "pct") {
    const sign = d >= 0 ? "+" : "−";
    return `${sign}${Math.abs(d).toFixed(2)} pts`;
  }
  const sign = d >= 0 ? "+" : "−";
  return `${sign}${Math.abs(d).toLocaleString("fr-FR", { maximumFractionDigits: 4 })}`;
}

const SYMEA_POS: Record<string, string> = {
  after_transports: "Après transports",
  before_transports: "Avant transports",
};

const SIM_TYPE: Record<string, string> = {
  tariff: "Tarif",
  project: "Projet",
};

const STATUS: Record<string, string> = {
  draft: "Brouillon",
  finalized: "Finalisée",
  archived: "Archivée",
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fr-FR");
}

function colContextValue(col: CompareColumn, fieldId: string): string {
  const ctx = col.context;
  const mp = ctx.market_params;
  const agg = col.aggregates;

  switch (fieldId) {
    case "type":
      return col.type === "recalculation"
        ? "Snapshot recalcul"
        : SIM_TYPE[ctx.simulation_type ?? ""] ?? "—";
    case "status":
      return col.status ? (STATUS[col.status] ?? "—") : "—";
    case "calculated_at":
      return fmtDate(ctx.calculated_at);
    case "odoo_snapshot_at":
      return fmtDate(ctx.odoo_snapshot_at);
    case "trigger":
      return recalcTriggerLabel(ctx.trigger_type);
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
      return SYMEA_POS[ctx.symea_margin_position] ?? "—";
    case "sale_incoterm":
      return formatIncotermDisplay(ctx.sale_incoterm ?? "EXW", ctx.sale_incoterm_location);
    case "chain_modules":
      return ctx.chain_module_count > 0 ? `${ctx.chain_module_count} module${ctx.chain_module_count > 1 ? "s" : ""}` : "—";
    case "note":
      return ctx.note ?? "—";
    case "agg_lines":
      return agg.line_count != null ? String(agg.line_count) : "—";
    case "agg_avg_pa":
      return fmtEur(agg.avg_pa_eur);
    case "agg_avg_pr":
      return fmtEur(agg.avg_pr_eur);
    case "agg_avg_pv":
      return fmtEur(agg.avg_pv_eur);
    case "agg_avg_margin":
      return agg.avg_margin ? `${decToPct(agg.avg_margin)} %` : "—";
    case "agg_min_pv":
      return fmtEur(agg.min_pv_eur);
    case "agg_max_pv":
      return fmtEur(agg.max_pv_eur);
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
  label: string;
  deltaUnit?: "eur" | "pct" | "raw";
}

const SECTIONS: { title: string; fields: FieldDef[] }[] = [
  {
    title: "Identité & dates",
    fields: [
      { id: "type", label: "Type" },
      { id: "status", label: "Statut" },
      { id: "calculated_at", label: "Dernier calcul" },
      { id: "odoo_snapshot_at", label: "Snapshot Odoo" },
      { id: "trigger", label: "Déclencheur" },
      { id: "note", label: "Note" },
    ],
  },
  {
    title: "Paramètres marché",
    fields: [
      { id: "copper_base", label: "Cuivre base (RMB)", deltaUnit: "raw" },
      { id: "copper_current", label: "Cuivre actuel (RMB)", deltaUnit: "raw" },
      { id: "fx_eur_rmb", label: "FX EUR → RMB", deltaUnit: "raw" },
      { id: "fx_eur_usd", label: "FX EUR → USD", deltaUnit: "raw" },
    ],
  },
  {
    title: "Paramètres simulation",
    fields: [
      { id: "mix", label: "Mix stock / achat", deltaUnit: "pct" },
      { id: "margin_syskern", label: "Marge SysKern", deltaUnit: "pct" },
      { id: "margin_symea", label: "Marge Symea", deltaUnit: "pct" },
      { id: "symea_position", label: "Position marge Symea" },
      { id: "sale_incoterm", label: "Incoterm vente" },
      { id: "chain_modules", label: "Chaîne de calcul" },
    ],
  },
  {
    title: "Agrégats résultats",
    fields: [
      { id: "agg_lines", label: "Lignes" },
      { id: "agg_avg_pa", label: "PA moyen", deltaUnit: "eur" },
      { id: "agg_avg_pr", label: "PR moyen", deltaUnit: "eur" },
      { id: "agg_avg_pv", label: "PV moyen", deltaUnit: "eur" },
      { id: "agg_avg_margin", label: "Marge moyenne", deltaUnit: "pct" },
      { id: "agg_min_pv", label: "PV minimum", deltaUnit: "eur" },
      { id: "agg_max_pv", label: "PV maximum", deltaUnit: "eur" },
      { id: "agg_warnings", label: "Avertissements" },
      { id: "agg_errors", label: "Erreurs" },
    ],
  },
];

export function buildDiffSections(columns: CompareColumn[]): { title: string; rows: DiffRow[] }[] {
  const baseKey = columns[0]?.key;
  return SECTIONS.map((section) => ({
    title: section.title,
    rows: section.fields.map((field) => {
      const values: Record<string, string> = {};
      for (const col of columns) {
        values[col.key] = colContextValue(col, field.id);
      }
      const ref = baseKey ? values[baseKey] : "";
      const hasDiff = columns.some(
        (c) => c.key !== baseKey && diffKind(ref, values[c.key]) !== "same"
      );
      return { id: field.id, label: field.label, values, hasDiff, deltaUnit: field.deltaUnit };
    }),
  }));
}

/** Count rows that differ from reference across all sections. */
export function countDiffs(sections: { rows: DiffRow[] }[]): number {
  return sections.reduce((n, s) => n + s.rows.filter((r) => r.hasDiff).length, 0);
}
