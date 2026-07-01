"use client";

import Link from "next/link";
import useSWR from "swr";
import { ChartLine, CurrencyCircleDollar } from "@phosphor-icons/react";
import { listMarketParameters, type MarketParameter } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const COPPER_UNIT_LABELS: Record<string, string> = {
  tonne: "t",
  kg: "kg",
  lb: "lb",
};

function formatFx(value?: string | null): string {
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (Number.isNaN(n)) return value;
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function copperUnitLabel(unit?: string | null): string {
  if (!unit) return "t";
  return COPPER_UNIT_LABELS[unit] ?? unit;
}

function paramKey(p: MarketParameter): string {
  if (p.parameter_type === "copper_price") {
    return `copper:${p.copper_market ?? ""}`;
  }
  return `fx:${p.fx_from_currency ?? ""}:${p.fx_to_currency ?? ""}`;
}

/** Latest active row per copper market / FX pair. */
function currentMarketParams(params: MarketParameter[]): MarketParameter[] {
  const sorted = [...params].sort(
    (a, b) => new Date(b.valid_from).getTime() - new Date(a.valid_from).getTime(),
  );
  const byKey = new Map<string, MarketParameter>();
  for (const p of sorted) {
    const key = paramKey(p);
    if (!byKey.has(key)) byKey.set(key, p);
  }
  return [...byKey.values()].sort((a, b) => {
    if (a.parameter_type !== b.parameter_type) {
      return a.parameter_type === "copper_price" ? -1 : 1;
    }
    const aLabel =
      a.parameter_type === "copper_price"
        ? (a.copper_market ?? "")
        : `${a.fx_from_currency}${a.fx_to_currency}`;
    const bLabel =
      b.parameter_type === "copper_price"
        ? (b.copper_market ?? "")
        : `${b.fx_from_currency}${b.fx_to_currency}`;
    return aLabel.localeCompare(bLabel);
  });
}

function MarketParamRow({ param }: { param: MarketParameter }) {
  const isCopper = param.parameter_type === "copper_price";
  const validFrom = new Date(param.valid_from).toLocaleDateString("fr-FR");

  return (
    <div className="flex items-start gap-3 rounded-lg bg-muted/40 px-3 py-2.5">
      {isCopper ? (
        <ChartLine size={18} className="mt-0.5 shrink-0 text-warm" weight="duotone" />
      ) : (
        <CurrencyCircleDollar size={18} className="mt-0.5 shrink-0 text-primary" weight="duotone" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-muted-foreground">
          {isCopper
            ? `Cuivre ${param.copper_market ?? "—"}`
            : `FX ${param.fx_from_currency} → ${param.fx_to_currency}`}
        </p>
        <p className="text-sm font-semibold tabular-nums text-foreground">
          {isCopper
            ? `${param.copper_price} ${param.copper_currency}/${copperUnitLabel(param.copper_unit)}`
            : `1 ${param.fx_from_currency} = ${formatFx(param.fx_rate)} ${param.fx_to_currency}`}
        </p>
        <p className="text-[11px] text-muted-foreground">Valide depuis le {validFrom}</p>
      </div>
    </div>
  );
}

export function DashboardMarketCard() {
  const { data, isLoading } = useSWR("market-params-active", () =>
    listMarketParameters({ activeOnly: true }),
  );

  const params = data ? currentMarketParams(data) : [];

  if (isLoading) {
    return (
      <section className="rounded-xl border bg-card p-4 shadow-[var(--shadow-soft)]">
        <Skeleton className="mb-3 h-5 w-40" />
        <Skeleton className="h-32 rounded-lg" />
      </section>
    );
  }

  return (
    <section className="rounded-xl border bg-card p-4 shadow-[var(--shadow-soft)]">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Paramètres marché</h2>
        <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/settings?tab=marche" />}>
          Gérer
        </Button>
      </div>

      {params.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Aucun paramètre marché actif. Saisissez le cuivre et les taux de change.
        </p>
      ) : (
        <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
          {params.map((param) => (
            <MarketParamRow key={param.id} param={param} />
          ))}
        </div>
      )}
    </section>
  );
}
