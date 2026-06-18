"use client";

import { useState } from "react";
import useSWR from "swr";
import { TrendingUp } from "lucide-react";
import {
  Line,
  LineChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  activateSupplier,
  createSupplier,
  deleteSupplier,
  getPriceHistory,
  getProductSuppliers,
  updateSupplier,
  type ProductSupplier,
  type ProductSupplierInput,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { canEdit } from "@/lib/auth";
import { SupplierManager } from "@/components/SupplierManager";
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

export function CommercialTab() {
  const { product } = useEdit();
  const { role } = useAuth();
  const userCanEdit = canEdit(role);
  const pamp = parseDec(product.pamp_eur);
  const stock = parseDec(product.stock_quantity);

  const [period, setPeriod] = useState<"3m" | "6m" | "12m">("6m");
  const { data: history, isLoading } = useSWR(["price-history", product.sku_code, period], () =>
    getPriceHistory(product.sku_code, period),
  );

  const points = history?.points ?? [];
  const latestPv = points.length ? parseDec(points[0].pv_eur) : 0;
  const chartData = points.map((p) => ({
    date: new Date(p.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }),
    PA: p.pa_eur != null ? parseFloat(p.pa_eur) : null,
    PR: p.pr_eur != null ? parseFloat(p.pr_eur) : null,
    PV: p.pv_eur != null ? parseFloat(p.pv_eur) : null,
  }));

  const { data: suppliers, mutate: mutateSuppliers } = useSWR<ProductSupplier[]>(
    ["product-suppliers", product.id],
    () => getProductSuppliers(product.id),
    { fallbackData: product.suppliers ?? [] },
  );

  const handleCreate = async (data: ProductSupplierInput) => {
    await createSupplier(product.id, data);
    await mutateSuppliers();
  };
  const handleUpdate = async (id: string, data: ProductSupplierInput) => {
    await updateSupplier(product.id, id, data);
    await mutateSuppliers();
  };
  const handleDelete = async (id: string) => {
    await deleteSupplier(product.id, id);
    await mutateSuppliers();
  };
  const handleActivate = async (id: string) => {
    await activateSupplier(product.id, id);
    await mutateSuppliers();
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <div className="bg-white border-2 border-[#E07200] rounded-xl p-5 shadow-sm">
          <div className="text-xs font-semibold text-[#E07200] uppercase tracking-wide mb-1">PAMP actuel</div>
          <div className="text-2xl font-bold text-slate-900 mt-2">
            {pamp > 0 ? `${pamp.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €` : "—"}
          </div>
          {product.pamp_synced_at && (
            <div className="text-xs text-slate-400 mt-2">
              Synchronisé le {new Date(product.pamp_synced_at).toLocaleDateString("fr-FR")}
            </div>
          )}
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-xl p-5 shadow-sm">
          <div className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-1">Prix de vente actuel</div>
          <div className="text-2xl font-bold text-slate-900 mt-2">
            {latestPv > 0
              ? `${latestPv.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
              : "—"}
          </div>
          <div className="text-xs text-slate-400 mt-2">Dernière simulation finalisée</div>
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-xl p-5 shadow-sm">
          <div className="text-xs font-semibold text-green-600 uppercase tracking-wide mb-1">Stock disponible</div>
          <div className="text-2xl font-bold text-slate-900 mt-2">
            {Math.round(stock)}
            <span className="text-base font-normal text-slate-500 ml-1">unités</span>
          </div>
          <div
            className={cn(
              "inline-flex items-center gap-1 text-xs font-medium mt-2 px-2 py-0.5 rounded",
              stock > 0 ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500",
            )}
          >
            <span className={cn("w-1.5 h-1.5 rounded-full", stock > 0 ? "bg-green-500" : "bg-slate-300")} />
            {stock > 0 ? "En stock" : "Rupture"}
          </div>
        </div>
      </div>

      <div className="bg-white border border-[#E2E8F0] rounded-xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <TrendingUp size={15} className="text-[#E07200]" />
            <h3 className="text-sm font-semibold text-slate-700">Historique PA / PR / PV</h3>
          </div>
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                onClick={() => setPeriod(p.id)}
                className={cn(
                  "px-3 py-1 rounded-md text-xs font-medium transition-colors",
                  period === p.id ? "bg-white text-[#E07200] shadow-sm" : "text-slate-500 hover:text-slate-700",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        {isLoading ? (
          <div className="h-48 flex items-center justify-center text-sm text-slate-400">Chargement…</div>
        ) : chartData.length === 0 ? (
          <div className="h-48 flex flex-col items-center justify-center text-center gap-1 text-slate-400">
            <p className="text-sm font-medium text-slate-500">Aucun historique de prix</p>
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
                <Line type="monotone" dataKey="PA" stroke="#16A34A" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                <Line type="monotone" dataKey="PR" stroke="#E07200" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                <Line type="monotone" dataKey="PV" stroke="#2563EB" strokeWidth={2} dot={{ r: 3 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="bg-white border border-[#E2E8F0] rounded-xl p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">Fournisseurs</h3>
        <SupplierManager
          suppliers={suppliers ?? []}
          onCreate={handleCreate}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
          onActivate={handleActivate}
          readOnly={!userCanEdit}
        />
      </div>

      <AttributeSection
        category="commercial"
        title="Attributs commerciaux"
        emptyLabel="Aucun attribut commercial défini."
      />
    </div>
  );
}
