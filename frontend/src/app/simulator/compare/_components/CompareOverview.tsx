"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  TrendUp,
  TrendDown,
  Minus,
} from "@phosphor-icons/react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CompareColumn, CompareProduct } from "@/lib/api";
import { decToPct, fmtEur } from "@/app/simulator/[id]/_components/sim-format";
import { buildSimulationHref, type SimulationNavigationContext } from "@/lib/simulation-navigation";
import { cn } from "@/lib/utils";
import { buildDiffSections } from "./compare-diff";
import { columnVisuals, deltaBg, deltaColor } from "./compare-colors";
import {
  buildAggregateChartData,
  buildKpiCards,
  buildMarketCompare,
  buildTopMovers,
  computePvDistribution,
  countParamDiffs,
} from "./compare-stats";

interface Props {
  columns: CompareColumn[];
  products: CompareProduct[];
  simulationNavContext?: SimulationNavigationContext;
}

export function CompareOverview({
  columns,
  products,
  simulationNavContext = { kind: "default" },
}: Props) {
  const baseKey = columns[0]?.key ?? "";
  const visuals = useMemo(
    () => columnVisuals(columns.map((c) => c.label), columns.map((c) => c.key)),
    [columns]
  );
  const chartData = useMemo(() => buildAggregateChartData(columns), [columns]);
  const distribution = useMemo(
    () => computePvDistribution(products, columns, baseKey),
    [products, columns, baseKey]
  );
  const movers = useMemo(
    () => buildTopMovers(products, columns, baseKey, 8),
    [products, columns, baseKey]
  );
  const marketRows = useMemo(() => buildMarketCompare(columns), [columns]);
  const kpiCards = useMemo(() => buildKpiCards(columns), [columns]);
  const paramDiffs = useMemo(() => {
    return buildDiffSections(columns)
      .flatMap((s) => s.rows.filter((r) => r.hasDiff))
      .slice(0, 12);
  }, [columns]);
  const paramDiffCount = countParamDiffs(columns);

  const pieData = [
    { name: "PV en hausse", value: distribution.up, color: "#EF4444" },
    { name: "PV stable", value: distribution.stable, color: "#10B981" },
    { name: "PV en baisse", value: distribution.down, color: "#3B82F6" },
    { name: "Sans donnée", value: distribution.missing, color: "#CBD5E1" },
  ].filter((d) => d.value > 0);

  const marketDiffs = marketRows.filter((r) => r.hasDiff);

  return (
    <div className="space-y-6">
      {/* Column identity cards */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {visuals.map((v, i) => {
          const col = columns[i];
          const agg = col.aggregates;
          return (
            <div
              key={v.key}
              className={cn(
                "relative overflow-hidden rounded-xl border p-4 shadow-sm",
                v.isRef ? "border-warm/30 bg-gradient-to-br from-warm/10 to-white" : "border-border bg-card"
              )}
            >
              <div
                className="absolute left-0 top-0 h-1 w-full"
                style={{ backgroundColor: v.color }}
              />
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link
                    href={buildSimulationHref(col.simulation_id, simulationNavContext)}
                    className="block truncate text-sm font-semibold text-foreground hover:text-warm"
                    title={v.label}
                  >
                    {v.label}
                  </Link>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {v.isRef && (
                      <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold text-orange-800">
                        Référence
                      </span>
                    )}
                    {col.type === "recalculation" && (
                      <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-800">
                        Snapshot
                      </span>
                    )}
                  </div>
                </div>
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                  style={{ backgroundColor: v.color }}
                >
                  {String.fromCharCode(65 + i)}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <MiniStat label="Lignes" value={String(agg.line_count ?? "—")} />
                <MiniStat label="PV moy." value={fmtEur(agg.avg_pv_eur)} />
                <MiniStat label="Marge moy." value={agg.avg_margin ? `${decToPct(agg.avg_margin)} %` : "—"} />
                <MiniStat
                  label="Alertes"
                  value={`${agg.warnings_count ?? 0} / ${agg.errors_count ?? 0}`}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* KPI delta cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kpiCards.map((kpi) => (
          <KpiDeltaCard key={kpi.label} kpi={kpi} visuals={visuals} baseKey={baseKey} />
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Aggregate bar chart */}
        <ChartCard title="Moyennes PA / PR / PV" subtitle="Comparaison des agrégats par colonne">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="metric" tick={{ fontSize: 11, fill: "#64748B" }} />
              <YAxis tick={{ fontSize: 11, fill: "#64748B" }} tickFormatter={(v) => `${v} €`} />
              <Tooltip
                formatter={(v) => [`${Number(v ?? 0).toFixed(2)} €`, ""]}
                contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", fontSize: 12 }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {visuals.map((v) => (
                <Bar key={v.key} dataKey={v.key} name={v.shortLabel} fill={v.color} radius={[4, 4, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* PV distribution pie */}
        <ChartCard title="Impact PV sur les SKU" subtitle="Écart vs référence (lignes communes)">
          {pieData.length > 0 ? (
            <div className="flex flex-col items-center gap-4 sm:flex-row">
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={2}
                  >
                    {pieData.map((d) => (
                      <Cell key={d.name} fill={d.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
              <ul className="space-y-2 text-sm">
                {pieData.map((d) => (
                  <li key={d.name} className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                    <span className="text-muted-foreground">{d.name}</span>
                    <span className="ml-auto font-semibold tabular-nums text-foreground">{d.value}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="py-16 text-center text-sm text-muted-foreground">Pas assez de données.</p>
          )}
        </ChartCard>
      </div>

      {/* Market params - only if different */}
      {marketDiffs.length > 0 && (
        <ChartCard
          title="Paramètres marché (écarts)"
          subtitle={`${marketDiffs.length} indicateur${marketDiffs.length > 1 ? "s" : ""} différent${marketDiffs.length > 1 ? "s" : ""}`}
        >
          <div className="space-y-5">
            {marketDiffs.map((row) => {
              const max = Math.max(...Object.values(row.values), 0.001);
              return (
                <div key={row.field}>
                  <div className="mb-2 text-xs font-semibold text-muted-foreground">{row.label}</div>
                  <div className="space-y-2">
                    {visuals.map((v) => {
                      const val = row.values[v.key] ?? 0;
                      const ref = row.values[baseKey] ?? 0;
                      const pct = max > 0 ? (val / max) * 100 : 0;
                      const changed = v.key !== baseKey && val !== ref;
                      return (
                        <div key={v.key} className="flex items-center gap-3">
                          <span
                            className="w-24 shrink-0 truncate text-[11px] font-medium"
                            style={{ color: v.color }}
                          >
                            {v.shortLabel}
                          </span>
                          <div className="relative h-6 flex-1 overflow-hidden rounded-md bg-muted">
                            <div
                              className="absolute inset-y-0 left-0 rounded-md transition-all"
                              style={{
                                width: `${Math.max(pct, 2)}%`,
                                backgroundColor: changed ? v.color : `${v.color}99`,
                              }}
                            />
                            <span className="relative z-10 flex h-full items-center px-2 text-[11px] font-semibold tabular-nums text-foreground">
                              {val.toLocaleString("fr-FR", { maximumFractionDigits: 4 })}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </ChartCard>
      )}

      {/* Top movers */}
      {movers.length > 0 && (
        <ChartCard title="Plus grands écarts de PV" subtitle="Top SKU par variation % vs référence">
          <div className="space-y-3">
            {movers.map((m) => (
              <div
                key={m.productId}
                className="rounded-lg border border-border bg-muted/50 px-3 py-2.5"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-mono text-xs font-bold text-warm">{m.sku}</span>
                    <span className="ml-2 truncate text-xs text-muted-foreground">{m.name}</span>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    Réf. {fmtEur(String(m.basePv))}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {m.deltas.map((d) => {
                    const vis = visuals.find((v) => v.key === d.key);
                    const barW = Math.min(Math.abs(d.deltaPct) * 8, 100);
                    return (
                      <div key={d.key} className="flex items-center gap-2">
                        <span className="w-20 shrink-0 text-[10px] font-medium" style={{ color: vis?.color }}>
                          {vis?.shortLabel}
                        </span>
                        <div className="relative h-5 flex-1 overflow-hidden rounded bg-card ring-1 ring-slate-100">
                          <div
                            className="absolute inset-y-0 rounded"
                            style={{
                              width: `${barW}%`,
                              backgroundColor: deltaColor(d.deltaPct),
                              opacity: 0.35,
                              left: d.deltaPct >= 0 ? 0 : undefined,
                              right: d.deltaPct < 0 ? 0 : undefined,
                            }}
                          />
                          <span className="relative flex h-full items-center justify-between px-2 text-[11px] font-semibold tabular-nums">
                            <span>{fmtEur(String(d.pv))}</span>
                            <DeltaBadge pct={d.deltaPct} />
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </ChartCard>
      )}

      {/* Param diff chips */}
      {paramDiffCount > 0 && (
        <div className="rounded-xl border border-warm/30 bg-gradient-to-r from-amber-50/80 to-white p-4">
          <div className="mb-3 flex items-center gap-2">
            <TrendUp size={16} className="text-warm" />
            <h3 className="text-sm font-semibold text-foreground">
              {paramDiffCount} paramètre{paramDiffCount > 1 ? "s" : ""} modifié{paramDiffCount > 1 ? "s" : ""}
            </h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {paramDiffs.map((row) => (
              <span
                key={row.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-warm/30 bg-card px-3 py-1 text-xs font-medium text-foreground shadow-sm"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-warm/100" />
                {row.label}
              </span>
            ))}
            {paramDiffCount > paramDiffs.length && (
              <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
                +{paramDiffCount - paramDiffs.length} autres
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-card/80 px-2 py-1.5 ring-1 ring-slate-100">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-semibold tabular-nums text-foreground">{value}</div>
    </div>
  );
}

function KpiDeltaCard({
  kpi,
  visuals,
  baseKey,
}: {
  kpi: ReturnType<typeof buildKpiCards>[0];
  visuals: ReturnType<typeof columnVisuals>;
  baseKey: string;
}) {
  const nonRef = kpi.values.filter((v) => v.key !== baseKey && v.deltaPct != null);
  const worst = nonRef.reduce(
    (best, v) => (best == null || Math.abs(v.deltaPct!) > Math.abs(best.deltaPct!) ? v : best),
    null as (typeof nonRef)[0] | null
  );

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{kpi.label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-foreground">
        {kpi.refValue != null
          ? kpi.label.includes("Marge")
            ? `${(kpi.refValue * 100).toFixed(1)} %`
            : fmtEur(String(kpi.refValue))
          : "—"}
      </div>
      {worst && (
        <div className={cn("mt-2 inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold", deltaBg(worst.deltaPct!))}>
          <DeltaBadge pct={worst.deltaPct!} />
          <span className="text-muted-foreground">max écart</span>
        </div>
      )}
      <div className="mt-3 flex gap-1">
        {visuals.map((v) => {
          const val = kpi.values.find((x) => x.key === v.key);
          const h = val?.value != null && kpi.refValue != null && kpi.refValue > 0
            ? Math.min((val.value / kpi.refValue) * 100, 150)
            : 50;
          return (
            <div key={v.key} className="flex flex-1 flex-col items-center gap-1">
              <div className="flex h-12 w-full items-end justify-center rounded bg-muted px-0.5">
                <div
                  className="w-full rounded-t transition-all"
                  style={{ height: `${Math.max(h * 0.7, 8)}%`, backgroundColor: v.color, opacity: v.isRef ? 1 : 0.75 }}
                />
              </div>
              <span className="text-[9px] font-medium text-muted-foreground">{String.fromCharCode(65 + visuals.indexOf(v))}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DeltaBadge({ pct }: { pct: number }) {
  const Icon = pct > 0.5 ? TrendUp : pct < -0.5 ? TrendDown : Minus;
  const color = deltaColor(pct);
  return (
    <span className="inline-flex items-center gap-0.5 font-semibold tabular-nums" style={{ color }}>
      <Icon size={12} />
      {pct >= 0 ? "+" : ""}
      {pct.toFixed(1)} %
    </span>
  );
}
