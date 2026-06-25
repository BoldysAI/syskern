"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChartBar, SquaresFour, Table } from "@phosphor-icons/react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CompareCell, CompareColumn, CompareProduct } from "@/lib/api";
import { decToPct, fmtEur } from "@/app/simulator/[id]/_components/sim-format";
import { cn } from "@/lib/utils";
import { columnVisuals, deltaBg, deltaColor } from "./compare-colors";
import { pvNum } from "./compare-stats";

interface Props {
  columns: CompareColumn[];
  products: CompareProduct[];
  sortByDelta: boolean;
  onToggleSort: () => void;
  commonOnly: boolean;
  onToggleCommon: () => void;
}

type ViewMode = "heatmap" | "chart" | "detail";

type MetricKey = "pa_net_eur" | "pr_eur" | "pv_eur" | "effective_margin_rate" | "effective_mix_pct";

const METRICS: { key: MetricKey; label: string }[] = [
  { key: "pa_net_eur", label: "PA" },
  { key: "pr_eur", label: "PR" },
  { key: "pv_eur", label: "PV" },
  { key: "effective_margin_rate", label: "Marge" },
  { key: "effective_mix_pct", label: "Mix" },
];

function metricRaw(c: CompareCell | undefined, key: MetricKey): string {
  if (!c) return "—";
  const v = c[key];
  if (v == null) return "—";
  if (key === "effective_margin_rate") return `${decToPct(String(v))} %`;
  if (key === "effective_mix_pct") return `${v} %`;
  return fmtEur(String(v));
}

function metricNumeric(
  c: CompareCell | undefined,
  key: MetricKey
): number | null {
  if (!c) return null;
  const v = c[key];
  if (v == null) return null;
  if (key === "effective_margin_rate") {
    const n = parseFloat(String(v));
    return Number.isFinite(n) ? n : null;
  }
  if (key === "effective_mix_pct") return typeof v === "number" ? v : null;
  return pvNum(String(v));
}

function metricDeltaRaw(
  cell: CompareCell | undefined,
  baseCell: CompareCell | undefined,
  key: MetricKey
): string | null {
  const r = metricNumeric(baseCell, key);
  const v = metricNumeric(cell, key);
  if (r == null || v == null || r === v) return null;
  const d = v - r;
  if (key === "effective_margin_rate") {
    const pts = d * 100;
    const sign = pts >= 0 ? "+" : "−";
    return `${sign}${Math.abs(pts).toFixed(2)} pts`;
  }
  if (key === "effective_mix_pct") {
    const sign = d >= 0 ? "+" : "−";
    return `${sign}${Math.abs(d).toFixed(0)} pts`;
  }
  const sign = d >= 0 ? "+" : "−";
  return `${sign}${fmtEur(Math.abs(d).toFixed(4))}`;
}

function metricChanged(
  cell: CompareCell | undefined,
  baseCell: CompareCell | undefined,
  key: MetricKey
): boolean {
  const r = metricNumeric(baseCell, key);
  const v = metricNumeric(cell, key);
  if (r == null && v == null) return false;
  if (r == null || v == null) return true;
  return r !== v;
}

function heatmapBg(deltaPct: number | null): string {
  if (deltaPct == null) return "bg-muted";
  const a = Math.abs(deltaPct);
  if (a < 0.5) return "bg-emerald-50/80";
  if (a < 2) return "bg-emerald-100/60";
  if (a < 5) return "bg-amber-100/70";
  if (a < 10) return "bg-orange-100/80";
  return "bg-red-100/80";
}

export function CompareSkuTable({
  columns,
  products,
  sortByDelta,
  onToggleSort,
  commonOnly,
  onToggleCommon,
}: Props) {
  const baseKey = columns[0]?.key ?? "";
  const visuals = useMemo(
    () => columnVisuals(columns.map((c) => c.label), columns.map((c) => c.key)),
    [columns]
  );
  const [viewMode, setViewMode] = useState<ViewMode>("heatmap");

  const rows = useMemo(() => {
    let list = products;
    if (commonOnly) {
      list = list.filter((p) => columns.every((c) => p.values[c.key]?.pv_eur != null));
    }
    const withDelta = list.map((p) => {
      const basePv = pvNum(p.values[baseKey]?.pv_eur);
      let maxAbsPct = 0;
      for (const c of columns) {
        if (c.key === baseKey) continue;
        const pv = pvNum(p.values[c.key]?.pv_eur);
        if (basePv != null && basePv !== 0 && pv != null) {
          maxAbsPct = Math.max(maxAbsPct, Math.abs(((pv - basePv) / basePv) * 100));
        }
      }
      return { product: p, maxAbsPct };
    });
    if (sortByDelta) withDelta.sort((a, b) => b.maxAbsPct - a.maxAbsPct);
    else withDelta.sort((a, b) => a.product.product_sku.localeCompare(b.product.product_sku));
    return withDelta.map((x) => x.product);
  }, [products, columns, baseKey, commonOnly, sortByDelta]);

  const chartRows = useMemo(() => {
    return rows.slice(0, 12).map((p) => {
      const row: Record<string, string | number> = { sku: p.product_sku };
      for (const c of columns) {
        row[c.key] = pvNum(p.values[c.key]?.pv_eur) ?? 0;
      }
      return row;
    });
  }, [rows, columns]);

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={commonOnly}
              onChange={onToggleCommon}
              className="h-4 w-4 rounded border-border accent-primary"
            />
            Lignes communes
          </label>
          <button
            type="button"
            onClick={onToggleSort}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
              sortByDelta
                ? "border-primary bg-accent text-accent-foreground"
                : "border-border text-muted-foreground hover:bg-muted"
            )}
          >
            {sortByDelta ? "Tri : écart PV ↓" : "Trier par écart PV"}
          </button>
          <span className="text-xs text-muted-foreground">{rows.length} lignes</span>
        </div>
        <div className="flex rounded-lg border border-border bg-card p-0.5">
          <ViewBtn active={viewMode === "heatmap"} onClick={() => setViewMode("heatmap")} icon={<SquaresFour size={14} />} label="Heatmap" />
          <ViewBtn active={viewMode === "chart"} onClick={() => setViewMode("chart")} icon={<ChartBar size={14} />} label="Graphique" />
          <ViewBtn active={viewMode === "detail"} onClick={() => setViewMode("detail")} icon={<Table size={14} />} label="Détail" />
        </div>
      </div>

      {(viewMode === "heatmap" || viewMode === "detail") && (
        <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
          <span className="font-semibold">Écart PV :</span>
          {[
            { label: "< 0,5 %", cls: "bg-emerald-100" },
            { label: "0,5–2 %", cls: "bg-emerald-200" },
            { label: "2–5 %", cls: "bg-amber-200" },
            { label: "5–10 %", cls: "bg-orange-200" },
            { label: "> 10 %", cls: "bg-red-200" },
          ].map((l) => (
            <span key={l.label} className="inline-flex items-center gap-1">
              <span className={cn("h-3 w-6 rounded", l.cls)} />
              {l.label}
            </span>
          ))}
        </div>
      )}

      {viewMode === "chart" && chartRows.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-foreground">PV par SKU (top {chartRows.length})</h3>
          <ResponsiveContainer width="100%" height={Math.max(280, chartRows.length * 36)}>
            <BarChart data={chartRows} layout="vertical" margin={{ left: 8, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `${v} €`} />
              <YAxis type="category" dataKey="sku" tick={{ fontSize: 10 }} width={72} />
              <Tooltip formatter={(v) => [`${Number(v ?? 0).toFixed(2)} €`, ""]} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {visuals.map((v) => (
                <Bar key={v.key} dataKey={v.key} name={v.shortLabel} fill={v.color} radius={[0, 3, 3, 0]} barSize={10} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {(viewMode === "heatmap" || viewMode === "detail") && (
        <div className="overflow-x-auto rounded-xl border border-border shadow-sm">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-background">
                <th className="sticky left-0 z-10 bg-background px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  SKU
                </th>
                {visuals.map((v, i) => (
                  <th key={v.key} className="min-w-[8rem] px-3 py-3 text-center">
                    <div className="flex flex-col items-center gap-1">
                      <span
                        className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white"
                        style={{ backgroundColor: v.color }}
                      >
                        {String.fromCharCode(65 + i)}
                      </span>
                      <Link
                        href={`/simulator/${columns[i].simulation_id}`}
                        className="max-w-[120px] truncate text-[11px] font-semibold text-foreground hover:text-warm"
                        title={v.label}
                      >
                        {v.shortLabel}
                      </Link>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const basePv = pvNum(p.values[baseKey]?.pv_eur);
                return (
                  <tr key={p.product_id} className="border-b border-border">
                    <td className="sticky left-0 z-10 max-w-[200px] bg-card px-4 py-2">
                      <span className="block font-mono text-xs font-bold text-warm">{p.product_sku}</span>
                      <span className="block truncate text-[10px] text-muted-foreground" title={p.product_name}>
                        {p.product_name}
                      </span>
                    </td>
                    {columns.map((c, i) => {
                      const cell = p.values[c.key];
                      const baseCell = p.values[baseKey];
                      const pv = pvNum(cell?.pv_eur);
                      const deltaPct =
                        i > 0 && basePv != null && basePv !== 0 && pv != null
                          ? ((pv - basePv) / basePv) * 100
                          : null;

                      if (viewMode === "detail") {
                        return (
                          <td key={c.key} className="px-2 py-2 align-top">
                            <div className="space-y-0.5">
                              {METRICS.map((m) => {
                                const val = metricRaw(cell, m.key);
                                const changed =
                                  i > 0 && metricChanged(cell, baseCell, m.key);
                                const delta = changed ? metricDeltaRaw(cell, baseCell, m.key) : null;
                                return (
                                  <div
                                    key={m.key}
                                    className={cn(
                                      "flex justify-between gap-1 rounded px-1.5 py-0.5 text-[10px] tabular-nums",
                                      m.key === "pv_eur" && i > 0 && deltaPct != null && heatmapBg(deltaPct),
                                      changed && m.key !== "pv_eur" && "bg-warm/10"
                                    )}
                                  >
                                    <span className="font-medium text-muted-foreground">{m.label}</span>
                                    <span className="font-semibold text-foreground">
                                      {val}
                                      {delta && <span className="ml-1 text-warm">{delta}</span>}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </td>
                        );
                      }

                      return (
                        <td key={c.key} className="px-2 py-2">
                          <div
                            className={cn(
                              "flex flex-col items-center justify-center rounded-lg px-2 py-3 text-center transition-colors",
                              i === 0 ? "bg-warm/10/60 ring-1 ring-orange-100" : heatmapBg(deltaPct)
                            )}
                          >
                            <div className="text-sm font-bold font-data text-foreground">
                              {fmtEur(cell?.pv_eur)}
                            </div>
                            {deltaPct != null && i > 0 && (
                              <span
                                className={cn(
                                  "mt-1 rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
                                  deltaBg(deltaPct)
                                )}
                                style={{ color: deltaColor(deltaPct) }}
                              >
                                {deltaPct >= 0 ? "+" : ""}
                                {deltaPct.toFixed(1)} %
                              </span>
                            )}
                            <div className="mt-1.5 text-[9px] text-muted-foreground">
                              PR {fmtEur(cell?.pr_eur)}
                            </div>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={columns.length + 1} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    Aucune ligne à comparer.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ViewBtn({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
        active ? "bg-accent text-accent-foreground shadow-sm" : "text-muted-foreground hover:bg-muted"
      )}
    >
      {icon}
      {label}
    </button>
  );
}
