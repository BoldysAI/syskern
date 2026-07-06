"use client";

import Link from "next/link";
import { ArrowSquareOut } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import type { CatalogPv } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { simulationHrefFromCatalog } from "@/app/simulator/[id]/_components/sim-format";

const CURRENCY_META = [
  { code: "EUR", field: "pv_eur" as const, symbol: "€", primary: true },
  { code: "USD", field: "pv_usd" as const, symbol: "$", primary: false },
  { code: "RMB", field: "pv_rmb" as const, symbol: "¥", primary: false },
] as const;

function parsePositive(value: string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = parseFloat(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function formatAmount(n: number): string {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const SIZE_STYLES = {
  sm: {
    list: "gap-1",
    row: "gap-2",
    badge: "min-w-[2.75rem] px-1.5 py-0.5 text-[10px]",
    amount: "text-sm font-semibold",
    primaryAmount: "text-sm font-bold text-primary",
  },
  md: {
    list: "gap-1.5",
    row: "gap-3",
    badge: "min-w-[3rem] px-2 py-0.5 text-[11px]",
    amount: "text-base font-semibold",
    primaryAmount: "text-lg font-bold text-primary",
  },
  lg: {
    list: "gap-2",
    row: "gap-3",
    badge: "min-w-[3.25rem] px-2 py-1 text-xs",
    amount: "text-lg font-semibold",
    primaryAmount: "text-2xl font-bold text-primary",
  },
} as const;

interface CatalogPvDisplayProps {
  pv?: CatalogPv | null;
  /** `stack` = liste verticale ; `inline` = une ligne séparée par · */
  layout?: "stack" | "inline";
  size?: keyof typeof SIZE_STYLES;
  className?: string;
}

function PvAmountRow({
  code,
  symbol,
  amount,
  primary,
  size,
}: {
  code: string;
  symbol: string;
  amount: number;
  primary: boolean;
  size: keyof typeof SIZE_STYLES;
}) {
  const s = SIZE_STYLES[size];
  return (
    <li className={cn("flex items-center", s.row, size === "sm" && "justify-end")}>
      <span
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-md border font-semibold uppercase tracking-wide",
          primary
            ? "border-primary/25 bg-primary/10 text-primary"
            : "border-border bg-muted/60 text-muted-foreground",
          s.badge,
        )}
        aria-hidden
      >
        {code}
      </span>
      <span
        className={cn(
          "min-w-0 font-data tabular-nums tracking-tight",
          size !== "sm" && "flex-1",
          primary ? s.primaryAmount : cn(s.amount, "text-foreground"),
        )}
      >
        {formatAmount(amount)}
        <span className="ml-1 text-[0.85em] font-medium text-muted-foreground">{symbol}</span>
      </span>
    </li>
  );
}

/** PV in EUR + USD + RMB (FX from the source simulation). */
export function CatalogPvDisplay({
  pv,
  layout = "stack",
  size = "sm",
  className,
}: CatalogPvDisplayProps) {
  const rows = CURRENCY_META.map((c) => ({
    ...c,
    amount: parsePositive(pv?.[c.field]),
  })).filter((r) => r.amount != null);

  if (!rows.length) {
    return <span className="text-muted-foreground/50">—</span>;
  }

  if (layout === "inline") {
    return (
      <span className={cn("font-data tabular-nums text-foreground", className)}>
        {rows
          .map((r) => `${formatAmount(r.amount!)} ${r.symbol}`)
          .join(" · ")}
      </span>
    );
  }

  const s = SIZE_STYLES[size];
  return (
    <ul className={cn("flex flex-col", s.list, className)}>
      {rows.map((r) => (
        <PvAmountRow
          key={r.code}
          code={r.code}
          symbol={r.symbol}
          amount={r.amount!}
          primary={r.primary}
          size={size}
        />
      ))}
    </ul>
  );
}

/** Latest point from price history with optional FX fields. */
export function latestPvFromHistory(
  points: {
    pv_eur?: string | null;
    pv_usd?: string | null;
    pv_rmb?: string | null;
    simulation_id?: string;
  }[],
): CatalogPv | null {
  if (!points.length) return null;
  const last = points[points.length - 1];
  if (!last.pv_eur) return null;
  return {
    pv_eur: last.pv_eur,
    pv_usd: last.pv_usd ?? null,
    pv_rmb: last.pv_rmb ?? null,
    simulation_id: last.simulation_id ?? "",
  };
}

export interface CatalogPvSource {
  pv: CatalogPv;
  simulationId: string;
  simulationLabel: string;
  date: string;
}

type HistoryPointLike = {
  date?: string;
  pv_eur?: string | null;
  pv_usd?: string | null;
  pv_rmb?: string | null;
  simulation_id?: string;
  simulation_label?: string;
};

/** PV + metadata of the latest price-history point (finalized simulation). */
export function latestPvSourceFromHistory(points: HistoryPointLike[]): CatalogPvSource | null {
  const pv = latestPvFromHistory(points);
  if (!pv || !points.length) return null;
  const last = points[points.length - 1];
  const simulationId = last.simulation_id ?? pv.simulation_id;
  if (!simulationId) return null;
  return {
    pv,
    simulationId,
    simulationLabel: last.simulation_label?.trim() || "Simulation",
    date: last.date ?? "",
  };
}

function formatSimulationDate(isoDate: string): string | null {
  if (!isoDate) return null;
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface CatalogPvSimulationSourceProps {
  source: CatalogPvSource | null | undefined;
  productSku: string;
  productLabel: string;
  productTab?: string;
  className?: string;
}

/** Simulation name, calculation date, and link below a PV block. */
export function CatalogPvSimulationSource({
  source,
  productSku,
  productLabel,
  productTab = "commercial",
  className,
}: CatalogPvSimulationSourceProps) {
  if (!source?.simulationId) return null;

  const when = formatSimulationDate(source.date);
  const href = simulationHrefFromCatalog(source.simulationId, {
    productSku,
    productLabel,
    productTab,
  });

  return (
    <div
      className={cn(
        "mt-3 flex flex-col gap-2 rounded-lg border border-border bg-muted/25 p-3",
        className,
      )}
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-foreground" title={source.simulationLabel}>
          {source.simulationLabel}
        </p>
        {when && <p className="mt-0.5 text-xs text-muted-foreground">{when}</p>}
      </div>
      <Button
        variant="outline"
        size="sm"
        className="h-8 w-full gap-1.5 sm:w-auto"
        nativeButton={false}
        render={<Link href={href} />}
      >
        <ArrowSquareOut size={14} weight="duotone" />
        Voir la simulation
      </Button>
    </div>
  );
}
