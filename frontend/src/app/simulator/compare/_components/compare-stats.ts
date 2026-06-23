import type { CompareColumn, CompareProduct } from "@/lib/api";
import { buildDiffSections } from "./compare-diff";

export function pvNum(v: string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

export interface AggregateChartRow {
  metric: string;
  [key: string]: string | number;
}

export function buildAggregateChartData(columns: CompareColumn[]): AggregateChartRow[] {
  const metrics: { id: string; label: string; field: keyof CompareColumn["aggregates"] }[] = [
    { id: "avg_pa", label: "PA moy.", field: "avg_pa_eur" },
    { id: "avg_pr", label: "PR moy.", field: "avg_pr_eur" },
    { id: "avg_pv", label: "PV moy.", field: "avg_pv_eur" },
  ];
  return metrics.map((m) => {
    const row: AggregateChartRow = { metric: m.label };
    for (const c of columns) {
      row[c.key] = pvNum(c.aggregates[m.field] as string) ?? 0;
    }
    return row;
  });
}

export interface PvDistribution {
  up: number;
  down: number;
  stable: number;
  missing: number;
}

export function computePvDistribution(
  products: CompareProduct[],
  columns: CompareColumn[],
  baseKey: string
): PvDistribution {
  const dist: PvDistribution = { up: 0, down: 0, stable: 0, missing: 0 };
  for (const p of products) {
    const base = pvNum(p.values[baseKey]?.pv_eur);
    if (base == null) {
      dist.missing++;
      continue;
    }
    let maxAbs = 0;
    for (const c of columns) {
      if (c.key === baseKey) continue;
      const pv = pvNum(p.values[c.key]?.pv_eur);
      if (pv == null) continue;
      if (base !== 0) maxAbs = Math.max(maxAbs, Math.abs(((pv - base) / base) * 100));
    }
    if (maxAbs < 0.5) dist.stable++;
    else {
      const anyUp = columns.some((c) => {
        if (c.key === baseKey) return false;
        const pv = pvNum(p.values[c.key]?.pv_eur);
        return pv != null && pv > base;
      });
      if (anyUp) dist.up++;
      else dist.down++;
    }
  }
  return dist;
}

export interface PvMover {
  productId: string;
  sku: string;
  name: string;
  basePv: number;
  deltas: { key: string; pv: number; deltaPct: number }[];
  maxAbsPct: number;
}

export function buildTopMovers(
  products: CompareProduct[],
  columns: CompareColumn[],
  baseKey: string,
  limit = 10
): PvMover[] {
  const movers: PvMover[] = [];
  for (const p of products) {
    const basePv = pvNum(p.values[baseKey]?.pv_eur);
    if (basePv == null || basePv === 0) continue;
    const deltas: PvMover["deltas"] = [];
    let maxAbsPct = 0;
    for (const c of columns) {
      if (c.key === baseKey) continue;
      const pv = pvNum(p.values[c.key]?.pv_eur);
      if (pv == null) continue;
      const deltaPct = ((pv - basePv) / basePv) * 100;
      maxAbsPct = Math.max(maxAbsPct, Math.abs(deltaPct));
      deltas.push({ key: c.key, pv, deltaPct });
    }
    if (deltas.length) movers.push({ productId: p.product_id, sku: p.product_sku, name: p.product_name, basePv, deltas, maxAbsPct });
  }
  movers.sort((a, b) => b.maxAbsPct - a.maxAbsPct);
  return movers.slice(0, limit);
}

export interface MarketCompareRow {
  label: string;
  field: string;
  values: Record<string, number>;
  hasDiff: boolean;
}

export function buildMarketCompare(columns: CompareColumn[]): MarketCompareRow[] {
  const fields = [
    { field: "copper_base_price_rmb", label: "Cuivre base (RMB)" },
    { field: "copper_current_price_rmb", label: "Cuivre actuel (RMB)" },
    { field: "fx_eur_rmb", label: "FX EUR → RMB" },
    { field: "fx_eur_usd", label: "FX EUR → USD" },
  ];
  const baseKey = columns[0]?.key;
  return fields.map(({ field, label }) => {
    const values: Record<string, number> = {};
    for (const c of columns) {
      const raw = c.context.market_params[field];
      values[c.key] = typeof raw === "number" ? raw : parseFloat(String(raw ?? "")) || 0;
    }
    const ref = baseKey ? values[baseKey] : 0;
    const hasDiff = columns.some((c) => c.key !== baseKey && values[c.key] !== ref);
    return { label, field, values, hasDiff };
  });
}

export function countParamDiffs(columns: CompareColumn[]): number {
  return buildDiffSections(columns).reduce((n, s) => n + s.rows.filter((r) => r.hasDiff).length, 0);
}

export interface KpiCard {
  label: string;
  refValue: number | null;
  values: { key: string; value: number | null; deltaPct: number | null }[];
}

export function buildKpiCards(columns: CompareColumn[]): KpiCard[] {
  const baseKey = columns[0]?.key;
  const defs: { label: string; get: (c: CompareColumn) => string | null | undefined }[] = [
    { label: "PV moyen", get: (c) => c.aggregates.avg_pv_eur },
    { label: "PR moyen", get: (c) => c.aggregates.avg_pr_eur },
    { label: "PA moyen", get: (c) => c.aggregates.avg_pa_eur },
    { label: "Marge moy.", get: (c) => c.aggregates.avg_margin },
  ];
  return defs.map((d) => {
    const refVal = baseKey ? pvNum(d.get(columns[0])) : null;
    const values = columns.map((c) => {
      const v = pvNum(d.get(c));
      const deltaPct =
        refVal != null && refVal !== 0 && v != null && c.key !== baseKey
          ? ((v - refVal) / refVal) * 100
          : null;
      return { key: c.key, value: v, deltaPct };
    });
    return { label: d.label, refValue: refVal, values };
  });
}
