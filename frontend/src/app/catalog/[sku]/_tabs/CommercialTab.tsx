"use client";

import { useState } from "react";
import useSWR from "swr";
import { TrendUp } from "@phosphor-icons/react";
import { Line, LineChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getPriceHistory } from "@/lib/api";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AttributeSection } from "./AttributeSection";
import { useEdit } from "./edit-context";

function parseDec(v?: string | null): number {
  return v != null ? parseFloat(v) : 0;
}

const PERIODS: { id: "3m" | "6m" | "12m"; label: string }[] = [
  { id: "3m", label: "3 mois" },
  { id: "6m", label: "6 mois" },
  { id: "12m", label: "12 mois" },
];

const CHART_PA = "var(--chart-1)";
const CHART_PR = "var(--chart-2)";
const CHART_PV = "var(--chart-3)";

export function CommercialTab() {
  const { product } = useEdit();
  const pamp = parseDec(product.pamp_eur);
  const stock = parseDec(product.stock_quantity);

  const [period, setPeriod] = useState<"3m" | "6m" | "12m">("6m");
  const { data: history, isLoading } = useSWR(["price-history", product.sku_code, period], () =>
    getPriceHistory(product.sku_code, period),
  );

  const points = history?.points ?? [];
  const latestPv = points.length ? parseDec(points[0].pv_eur) : 0;
  const chartData = points.map((p) => ({
    date: new Date(p.date).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "short",
    }),
    PA: p.pa_eur != null ? parseFloat(p.pa_eur) : null,
    PR: p.pr_eur != null ? parseFloat(p.pr_eur) : null,
    PV: p.pv_eur != null ? parseFloat(p.pv_eur) : null,
  }));

  const suppliers = product.suppliers ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
        <Card className="border-2 border-primary">
          <CardContent className="pt-5">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-warm">
              PAMP actuel
            </div>
            <div className="mt-2 text-2xl font-bold font-data text-foreground">
              {pamp > 0
                ? `${pamp.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
                : "—"}
            </div>
            {product.pamp_synced_at && (
              <div className="mt-2 text-xs text-muted-foreground">
                Synchronisé le {new Date(product.pamp_synced_at).toLocaleDateString("fr-FR")}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-brand-blue">
              Prix de vente actuel
            </div>
            <div className="mt-2 text-2xl font-bold font-data text-foreground">
              {latestPv > 0
                ? `${latestPv.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
                : "—"}
            </div>
            <div className="mt-2 text-xs text-muted-foreground">Dernière simulation finalisée</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-brand-green">
              Stock disponible
            </div>
            <div className="mt-2 text-2xl font-bold font-data text-foreground">
              {Math.round(stock)}
              <span className="ml-1 text-base font-normal font-sans text-muted-foreground">unités</span>
            </div>
            <StatusBadge variant={stock > 0 ? "success" : "draft"} className="mt-2 gap-1">
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  stock > 0 ? "bg-brand-green" : "bg-muted-foreground/40",
                )}
              />
              {stock > 0 ? "En stock" : "Rupture"}
            </StatusBadge>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 border-none pb-0">
          <div className="flex items-center gap-2">
            <TrendUp size={15} weight="duotone" className="text-warm" />
            <CardTitle className="text-sm font-semibold">Historique PA / PR / PV</CardTitle>
          </div>
          <div className="flex items-center gap-1 rounded-lg bg-muted p-0.5">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPeriod(p.id)}
                className={cn(
                  "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                  period === p.id
                    ? "bg-background text-warm shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          {isLoading ? (
            <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
              Chargement…
            </div>
          ) : chartData.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center gap-1 text-center text-muted-foreground">
              <p className="text-sm font-medium text-foreground">Aucun historique de prix</p>
              <p className="text-xs">
                Les points apparaîtront ici dès qu&apos;une simulation finalisée inclura ce produit.
              </p>
            </div>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={60} />
                  <Tooltip
                    formatter={(value) => {
                      const n = Array.isArray(value) ? NaN : Number(value);
                      return Number.isFinite(n)
                        ? `${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
                        : "—";
                    }}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="PA"
                    stroke={CHART_PA}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    connectNulls
                  />
                  <Line
                    type="monotone"
                    dataKey="PR"
                    stroke={CHART_PR}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    connectNulls
                  />
                  <Line
                    type="monotone"
                    dataKey="PV"
                    stroke={CHART_PV}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden p-0">
        <CardHeader className="border-none px-5 pt-5 pb-3">
          <CardTitle className="text-sm font-semibold">Fournisseurs</CardTitle>
        </CardHeader>
        {suppliers.length === 0 ? (
          <CardContent className="pb-5 text-sm text-muted-foreground">
            Aucun fournisseur enregistré.
          </CardContent>
        ) : (
          <table className="w-full">
            <thead className="border-y border-border bg-muted/30">
              <tr>
                {["Fournisseur", "Code usine", "Prix achat", "Devise", "Incoterm", "Actif"].map(
                  (h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {suppliers.map((s) => (
                <tr key={s.id} className="transition-colors hover:bg-muted/30">
                  <td className="px-4 py-3 text-sm font-medium text-foreground">
                    {s.supplier_name}
                  </td>
                  <td className="px-4 py-3 font-mono text-sm text-muted-foreground">
                    {s.factory_code || "—"}
                  </td>
                  <td className="px-4 py-3 text-sm font-data text-foreground">
                    {s.po_base_price
                      ? parseDec(s.po_base_price).toLocaleString("fr-FR", {
                          minimumFractionDigits: 2,
                        })
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{s.po_currency || "—"}</td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {s.incoterm
                      ? `${s.incoterm}${s.incoterm_location ? ` (${s.incoterm_location})` : ""}`
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge variant={s.is_active ? "success" : "draft"}>
                      {s.is_active ? "Oui" : "Non"}
                    </StatusBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <AttributeSection
        category="commercial"
        title="Attributs commerciaux"
        emptyLabel="Aucun attribut commercial défini."
      />
    </div>
  );
}
