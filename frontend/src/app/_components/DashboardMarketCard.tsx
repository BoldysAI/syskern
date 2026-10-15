"use client";

import Link from "next/link";
import useSWR from "swr";
import { ChartLine, CurrencyCircleDollar } from "@phosphor-icons/react";
import { listMarketParameters, type MarketParameter } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { uiDateLocale } from "@/lib/i18n";
import { useUiTranslate } from "@/lib/use-ui-translate";

const COPPER_UNIT_LABELS: Record<string, string> = {
  tonne: "t",
  kg: "kg",
  lb: "lb",
};

function formatFx(value: string | null | undefined, locale: string): string {
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (Number.isNaN(n)) return value;
  return n.toLocaleString(uiDateLocale(locale), { minimumFractionDigits: 2, maximumFractionDigits: 4 });
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
  const t = useUiTranslate();
  const { displayLanguage } = useAuth();
  const isCopper = param.parameter_type === "copper_price";
  const validFrom = new Date(param.valid_from).toLocaleDateString(uiDateLocale(displayLanguage));

  return (
    <div className="flex items-start gap-3 rounded-lg bg-muted/40 px-3 py-2.5">
      {isCopper ? (
        <ChartLine size={18} className="mt-0.5 shrink-0 text-brand-green" weight="duotone" />
      ) : (
        <CurrencyCircleDollar size={18} className="mt-0.5 shrink-0 text-primary" weight="duotone" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-muted-foreground">
          {isCopper
            ? t("dashboard.copperParam", { market: param.copper_market ?? "—" })
            : t("dashboard.fxParam", {
                from: param.fx_from_currency ?? "",
                to: param.fx_to_currency ?? "",
              })}
        </p>
        <p className="text-sm font-semibold tabular-nums text-foreground">
          {isCopper
            ? `${param.copper_price} ${param.copper_currency}/${copperUnitLabel(param.copper_unit)}`
            : t("dashboard.fxRate", {
                from: param.fx_from_currency ?? "",
                rate: formatFx(param.fx_rate, displayLanguage),
                to: param.fx_to_currency ?? "",
              })}
        </p>
        <p className="text-[11px] text-muted-foreground">{t("dashboard.validSince", { date: validFrom })}</p>
      </div>
    </div>
  );
}

export function DashboardMarketCard() {
  const t = useUiTranslate();
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
        <h2 className="text-sm font-semibold text-foreground">{t("dashboard.marketParams")}</h2>
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          render={<Link href="/settings?tab=marche" />}
        >
          {t("dashboard.manage")}
        </Button>
      </div>

      {params.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("dashboard.noMarketParams")}
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
