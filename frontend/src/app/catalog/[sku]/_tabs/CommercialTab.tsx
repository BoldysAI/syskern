"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import { TrendUp } from "@phosphor-icons/react";
import { Line, LineChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  activateProductSupplier,
  createSupplier,
  deleteProductSupplier,
  getPriceHistory,
  updateProductSupplier,
  type ProductSupplier,
  type ProductSupplierInput,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { productUnitLabel } from "@/lib/product-units";
import { StatusBadge } from "@/components/StatusBadge";
import { SupplierManager } from "@/components/SupplierManager";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { AttributeSection } from "./AttributeSection";
import { useEdit } from "./edit-context";
import { simulationHrefFromCatalog } from "@/app/simulator/[id]/_components/sim-format";
import {
  collapsePriceHistoryByDay,
  createClickableHistoryDot,
  formatPriceHistoryAxisLabel,
  formatPriceHistoryTooltipLabel,
  resolveChartPointIndex,
} from "./price-history-chart";
import {
  CatalogPvDisplay,
  CatalogPvSimulationSource,
  latestPvSourceFromHistory,
} from "@/app/catalog/_components/catalog-pv-display";

function parseDec(v?: string | null): number {
  return v != null ? parseFloat(v) : 0;
}

/**
 * Indexation cuivre appliquée pour une source d'achat (FEEDBACK 2).
 * `effective_copper` est calculé par l'API : le front n'a pas à rejouer la règle
 * d'héritage produit ↔ fournisseur.
 */
function CopperCell({ supplier }: { supplier: ProductSupplier }) {
  const eff = supplier.effective_copper;
  if (!eff?.is_copper_indexed) return <span className="text-muted-foreground/60">Non indexé</span>;
  const weight = eff.copper_weight_kg_per_unit;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-data text-foreground">
        {weight ? `${parseDec(weight).toLocaleString("fr-FR")} kg` : "poids manquant"}
      </span>
      <StatusBadge variant={eff.source === "supplier" ? "success" : "draft"}>
        {eff.source === "supplier" ? "fournisseur" : "hérité"}
      </StatusBadge>
    </span>
  );
}

const PERIODS: { id: "3m" | "6m" | "12m"; label: string }[] = [
  { id: "3m", label: "3 mois" },
  { id: "6m", label: "6 mois" },
  { id: "12m", label: "12 mois" },
];

const CHART_PA = "var(--chart-1)";
const CHART_PR = "var(--chart-2)";
const CHART_PV = "var(--chart-3)";

type ChartRow = {
  date: string;
  at: string;
  simulationId: string;
  simulationLabel: string;
  PA: number | null;
  PR: number | null;
  PV: number | null;
};

export function CommercialTab() {
  const router = useRouter();
  const { mode, product } = useEdit();
  const { mutate } = useSWRConfig();
  const productKey = useMemo(() => ["product", product.sku_code] as const, [product.sku_code]);
  const pamp = parseDec(product.pamp_eur);
  const stock = parseDec(product.stock_quantity);
  const editing = mode === "edit";

  const refreshProduct = useCallback(async () => {
    await mutate(productKey);
  }, [mutate, productKey]);

  const handleCreateSupplier = useCallback(
    async (data: ProductSupplierInput) => {
      await createSupplier(product.id, data);
      await refreshProduct();
      toast.success("Fournisseur ajouté");
    },
    [product.id, refreshProduct],
  );

  const handleUpdateSupplier = useCallback(
    async (id: string, data: ProductSupplierInput) => {
      await updateProductSupplier(product.id, id, data);
      await refreshProduct();
      toast.success("Fournisseur mis à jour");
    },
    [product.id, refreshProduct],
  );

  const handleDeleteSupplier = useCallback(
    async (id: string) => {
      await deleteProductSupplier(product.id, id);
      await refreshProduct();
      toast.success("Fournisseur supprimé");
    },
    [product.id, refreshProduct],
  );

  const handleActivateSupplier = useCallback(
    async (id: string) => {
      await activateProductSupplier(product.id, id);
      await refreshProduct();
      toast.success("Fournisseur défini comme source active");
    },
    [product.id, refreshProduct],
  );

  const [period, setPeriod] = useState<"3m" | "6m" | "12m">("6m");
  const { data: history, isLoading } = useSWR(["price-history", product.sku_code, period], () =>
    getPriceHistory(product.sku_code, period),
  );

  const points = useMemo(() => collapsePriceHistoryByDay(history?.points ?? []), [history?.points]);
  const latestPvSource = useMemo(() => latestPvSourceFromHistory(points), [points]);
  const chartData = useMemo(
    (): ChartRow[] =>
      points.map((p) => ({
        date: formatPriceHistoryAxisLabel(p.date),
        at: p.date,
        simulationId: p.simulation_id,
        simulationLabel: p.simulation_label,
        PA: p.pa_eur != null ? parseFloat(p.pa_eur) : null,
        PR: p.pr_eur != null ? parseFloat(p.pr_eur) : null,
        PV: p.pv_eur != null ? parseFloat(p.pv_eur) : null,
      })),
    [points],
  );

  const openSimulationById = useCallback(
    (simulationId: string) => {
      router.push(
        simulationHrefFromCatalog(simulationId, {
          productSku: product.sku_code,
          productLabel: product.name,
          productTab: "commercial",
        }),
      );
    },
    [product.name, product.sku_code, router],
  );

  const [hoveredPointIndex, setHoveredPointIndex] = useState<number | null>(null);

  const clickableDot = useMemo(
    () => createClickableHistoryDot(openSimulationById),
    [openSimulationById],
  );

  const suppliers = product.suppliers ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
        <Card className="border-2 border-primary">
          <CardContent className="pt-5">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-brand-green">
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
            <div className="mt-2">
              <CatalogPvDisplay pv={latestPvSource?.pv} layout="stack" size="lg" />
            </div>
            <CatalogPvSimulationSource
              source={latestPvSource}
              productSku={product.sku_code}
              productLabel={product.name}
              productTab="commercial"
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-brand-green">
              Stock disponible
            </div>
            <div className="mt-2 text-2xl font-bold font-data text-foreground">
              {Math.round(stock)}
              <span className="ml-1 text-base font-normal font-sans text-muted-foreground">
                {productUnitLabel(product)}
              </span>
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
        <CardHeader className="border-none pb-0">
          <div>
            <div className="flex items-center gap-2">
              <TrendUp size={15} weight="duotone" className="text-brand-green" />
              <CardTitle className="text-sm font-semibold">Historique PA / PR / PV</CardTitle>
            </div>
            {chartData.length > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                Cliquez sur un point ou dans le graphe pour ouvrir la simulation.
              </p>
            )}
          </div>
          <CardAction>
            <div
              role="group"
              aria-label="Période d'historique"
              className="inline-flex items-center gap-0.5 rounded-md bg-muted p-0.5"
            >
              {PERIODS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPeriod(p.id)}
                  className={cn(
                    "rounded px-2.5 py-0.5 text-xs font-medium leading-5 transition-colors",
                    period === p.id
                      ? "bg-background text-brand-green shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </CardAction>
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
            <div className={cn("h-56", hoveredPointIndex != null && "cursor-pointer")}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={chartData}
                  onMouseMove={(state) => {
                    setHoveredPointIndex(resolveChartPointIndex(state));
                  }}
                  onMouseLeave={() => setHoveredPointIndex(null)}
                  onClick={(state) => {
                    const idx = resolveChartPointIndex(state);
                    if (idx == null) return;
                    const row = chartData[idx];
                    if (row?.simulationId) openSimulationById(row.simulationId);
                  }}
                >
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={60} />
                  <Tooltip
                    labelFormatter={(_, payload) => {
                      const row = payload?.[0]?.payload as ChartRow | undefined;
                      if (!row?.at) return "";
                      return formatPriceHistoryTooltipLabel(row.at, row.simulationLabel);
                    }}
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
                    dot={clickableDot}
                    activeDot={false}
                    isAnimationActive={false}
                    connectNulls
                  />
                  <Line
                    type="monotone"
                    dataKey="PR"
                    stroke={CHART_PR}
                    strokeWidth={2}
                    dot={clickableDot}
                    activeDot={false}
                    isAnimationActive={false}
                    connectNulls
                  />
                  <Line
                    type="monotone"
                    dataKey="PV"
                    stroke={CHART_PV}
                    strokeWidth={2}
                    dot={clickableDot}
                    activeDot={false}
                    isAnimationActive={false}
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
          {!editing && (
            <p className="mt-1 text-xs text-muted-foreground">
              Activez le mode modification pour éditer le prix d&apos;achat et les autres champs
              fournisseur.
            </p>
          )}
        </CardHeader>
        {editing ? (
          <CardContent className="px-5 pb-5">
            <SupplierManager
              suppliers={product.suppliers ?? []}
              onCreate={handleCreateSupplier}
              onUpdate={handleUpdateSupplier}
              onDelete={handleDeleteSupplier}
              onActivate={handleActivateSupplier}
            />
          </CardContent>
        ) : suppliers.length === 0 ? (
          <CardContent className="pb-5 text-sm text-muted-foreground">
            Aucun fournisseur enregistré.
          </CardContent>
        ) : (
          <table className="w-full">
            <thead className="border-y border-border bg-muted/30">
              <tr>
                {[
                  "Fournisseur",
                  "Code usine",
                  "Prix achat",
                  "Devise",
                  "Incoterm",
                  "Cuivre",
                  "Actif",
                ].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {h}
                  </th>
                ))}
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
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {s.po_currency || "—"}
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {s.incoterm
                      ? `${s.incoterm}${s.incoterm_location ? ` (${s.incoterm_location})` : ""}`
                      : "—"}
                  </td>
                  {/* Cuivre effectif pour CETTE source (FEEDBACK 2). « hérité »
                      = la valeur du produit s'applique, pas de valeur propre. */}
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    <CopperCell supplier={s} />
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
