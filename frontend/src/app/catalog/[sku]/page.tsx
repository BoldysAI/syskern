"use client";

import { use } from "react";
import Link from "next/link";
import useSWR from "swr";
import * as Tabs from "@radix-ui/react-tabs";
import {
  ChevronRight,
  AlertCircle,
  Languages,
  TrendingUp,
  RefreshCw,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { getProduct, type ProductDetail, type ProductSupplier } from "@/lib/api";
import { cn } from "@/lib/utils";

const UNIVERSE_COLORS: Record<string, string> = {
  COPPER: "bg-amber-100 text-amber-800",
  "OPTICAL FIBER": "bg-blue-100 text-blue-800",
  OEM: "bg-purple-100 text-purple-800",
  RACKS: "bg-slate-100 text-slate-700",
};

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse bg-slate-200 rounded", className)} />;
}

function InfoRow({ label, value }: { label: string; value?: string | number | null | boolean }) {
  const display =
    value == null || value === ""
      ? null
      : typeof value === "boolean"
      ? value ? "Oui" : "Non"
      : String(value);
  return (
    <div className="flex justify-between py-2.5 border-b border-[#E2E8F0] last:border-0">
      <span className="text-sm text-slate-500">{label}</span>
      <span className="text-sm font-medium text-slate-800 text-right max-w-xs">
        {display ?? <span className="text-slate-300">—</span>}
      </span>
    </div>
  );
}

function parseDec(v?: string | null): number {
  return v != null ? parseFloat(v) : 0;
}

function TabGeneral({ product }: { product: ProductDetail }) {
  const activeSupplier = product.suppliers?.find((s) => s.is_active);
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="bg-white border border-[#E2E8F0] rounded-xl p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Informations générales</h3>
        <InfoRow label="SKU" value={product.sku_code} />
        <InfoRow label="Code article" value={product.item_code} />
        <InfoRow label="Référence parent" value={product.parent_reference} />
        <InfoRow label="Nom" value={product.name} />
        <InfoRow label="Univers" value={product.universe} />
        <InfoRow label="Famille" value={product.family} />
        <InfoRow label="Gamme" value={product.range} />
        <InfoRow label="Sous-gamme" value={product.sub_range} />
        <InfoRow label="Marque" value={product.brand} />
      </div>

      <div className="bg-white border border-[#E2E8F0] rounded-xl p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Identifiants & logistique</h3>
        <InfoRow label="GTIN" value={product.gtin} />
        <InfoRow label="Code HS" value={product.hs_code} />
        <InfoRow label="N° DOP" value={product.dop_number} />
        <InfoRow label="Odoo ID" value={product.odoo_id} />
        <InfoRow label="Unité de base" value={product.base_unit} />
        <InfoRow label="Poids unitaire (kg)" value={product.unit_weight_kg} />
        <InfoRow label="Politique d'approvisionnement" value={product.supply_policy} />
        <InfoRow label="Stockable" value={product.is_stockable} />
      </div>

      <div className="bg-white border border-[#E2E8F0] rounded-xl p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Conditionnement</h3>
        <InfoRow label="Qté colisage primaire" value={product.primary_packaging_qty} />
        <InfoRow label="Qté colisage secondaire" value={product.secondary_packaging_qty} />
        <InfoRow label="Qté colisage tertiaire" value={product.tertiary_packaging_qty} />
        <InfoRow label="Qté palette" value={product.pallet_qty} />
      </div>

      {activeSupplier && (
        <div className="bg-white border border-[#E2E8F0] rounded-xl p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Fournisseur actif</h3>
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            <div>
              <div className="text-xs text-slate-400 mb-0.5">Nom</div>
              <div className="font-semibold text-slate-800">{activeSupplier.supplier_name}</div>
            </div>
            {activeSupplier.factory_code && (
              <div>
                <div className="text-xs text-slate-400 mb-0.5">Code usine</div>
                <div className="font-mono text-sm text-slate-700">{activeSupplier.factory_code}</div>
              </div>
            )}
            {activeSupplier.po_base_price && (
              <div>
                <div className="text-xs text-slate-400 mb-0.5">Prix achat</div>
                <div className="font-semibold text-slate-800">
                  {parseDec(activeSupplier.po_base_price).toLocaleString("fr-FR", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 4,
                  })}{" "}
                  {activeSupplier.po_currency ?? "€"}
                </div>
              </div>
            )}
            {activeSupplier.incoterm && (
              <div>
                <div className="text-xs text-slate-400 mb-0.5">Incoterm</div>
                <div className="text-sm text-slate-700">
                  {activeSupplier.incoterm}
                  {activeSupplier.incoterm_location ? ` (${activeSupplier.incoterm_location})` : ""}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TabTarification({ product }: { product: ProductDetail }) {
  const pamp = parseDec(product.pamp_eur);
  const stock = parseDec(product.stock_quantity);
  const mockHistory = Array.from({ length: 6 }, (_, i) => ({
    month: new Date(Date.now() - (5 - i) * 30 * 86400000).toLocaleDateString("fr-FR", {
      month: "short",
    }),
    value: pamp > 0 ? pamp * (0.9 + Math.random() * 0.2) : null,
  }));

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      <div className="bg-white border-2 border-[#E07200] rounded-xl p-5 shadow-sm">
        <div className="text-xs font-semibold text-[#E07200] uppercase tracking-wide mb-1">
          PAMP actuel
        </div>
        <div className="text-3xl font-bold text-slate-900 mt-2">
          {pamp > 0
            ? `${pamp.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
            : "—"}
        </div>
        {product.pamp_synced_at && (
          <div className="text-xs text-slate-400 mt-2">
            Synchronisé le {new Date(product.pamp_synced_at).toLocaleDateString("fr-FR")}
          </div>
        )}
      </div>

      <div className="bg-white border border-[#E2E8F0] rounded-xl p-5 shadow-sm">
        <div className="text-xs font-semibold text-green-600 uppercase tracking-wide mb-1">
          Stock disponible
        </div>
        <div className="text-3xl font-bold text-slate-900 mt-2">
          {Math.round(stock)}
          <span className="text-base font-normal text-slate-500 ml-1">unités</span>
        </div>
        <div
          className={cn(
            "inline-flex items-center gap-1 text-xs font-medium mt-2 px-2 py-0.5 rounded",
            stock > 0 ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"
          )}
        >
          <span className={cn("w-1.5 h-1.5 rounded-full", stock > 0 ? "bg-green-500" : "bg-slate-300")} />
          {stock > 0 ? "En stock" : "Rupture"}
        </div>
      </div>

      <div className="bg-white border border-[#E2E8F0] rounded-xl p-5 shadow-sm">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
          Indexation cuivre
        </div>
        <div className="mt-2">
          <span
            className={cn(
              "inline-flex px-3 py-1 rounded-full text-sm font-semibold",
              product.is_copper_indexed
                ? "bg-amber-100 text-amber-800"
                : "bg-slate-100 text-slate-600"
            )}
          >
            {product.is_copper_indexed ? "Oui — indexé" : "Non indexé"}
          </span>
          {product.is_copper_indexed && product.copper_weight_kg_per_unit && (
            <div className="text-xs text-slate-500 mt-2">
              {parseDec(product.copper_weight_kg_per_unit).toFixed(4)} kg Cu / unité
            </div>
          )}
        </div>
      </div>

      {pamp > 0 && (
        <div className="bg-white border border-[#E2E8F0] rounded-xl p-5 shadow-sm md:col-span-2 lg:col-span-3">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp size={15} className="text-[#E07200]" />
            <h3 className="text-sm font-semibold text-slate-700">Évolution PAMP (6 derniers mois)</h3>
          </div>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={mockHistory}>
                <XAxis dataKey="month" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={60} />
                <Tooltip formatter={(v) => [`${Number(v).toFixed(2)} €`, "PAMP"]} />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#E07200"
                  strokeWidth={2}
                  dot={{ r: 3, fill: "#E07200" }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

function TabDescriptions({ product }: { product: ProductDetail }) {
  const langs = ["fr", "en", "es"];
  const langLabels: Record<string, string> = { fr: "Français", en: "Anglais", es: "Espagnol" };

  return (
    <div className="flex flex-col gap-6">
      {langs.map((lang) => {
        const marketing = product.description_marketing?.[lang];
        const technical = product.description_technical?.[lang];
        const hasContent = !!marketing || !!technical;
        return (
          <div key={lang} className="bg-white border border-[#E2E8F0] rounded-xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-700">{langLabels[lang]}</h3>
              {!hasContent && (
                <button className="flex items-center gap-1.5 text-xs font-medium text-[#E07200] hover:text-[#C56400] transition-colors">
                  <Languages size={13} />
                  Traduire avec DeepL
                </button>
              )}
            </div>
            {hasContent ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {marketing && (
                  <div>
                    <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">
                      Marketing
                    </div>
                    <p className="text-sm text-slate-700 leading-relaxed">{marketing}</p>
                  </div>
                )}
                {technical && (
                  <div>
                    <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">
                      Technique
                    </div>
                    <p className="text-sm text-slate-700 leading-relaxed">{technical}</p>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-400 italic">
                Aucune description disponible en {langLabels[lang].toLowerCase()}.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TabFournisseurs({ suppliers }: { suppliers: ProductSupplier[] }) {
  if (!suppliers?.length) {
    return (
      <div className="bg-white border border-[#E2E8F0] rounded-xl p-10 text-center text-slate-400 shadow-sm">
        Aucun fournisseur enregistré.
      </div>
    );
  }

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden shadow-sm">
      <table className="w-full">
        <thead className="bg-[#F5F7FA] border-b border-[#E2E8F0]">
          <tr>
            {["Fournisseur", "Code usine", "Prix achat", "Devise", "Incoterm", "Actif"].map((h) => (
              <th
                key={h}
                className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#E2E8F0]">
          {suppliers.map((s) => (
            <tr key={s.id} className="hover:bg-slate-50 transition-colors">
              <td className="px-4 py-3 text-sm font-medium text-slate-800">{s.supplier_name}</td>
              <td className="px-4 py-3 font-mono text-sm text-slate-600">{s.factory_code || "—"}</td>
              <td className="px-4 py-3 text-sm text-slate-700">
                {s.po_base_price
                  ? parseDec(s.po_base_price).toLocaleString("fr-FR", { minimumFractionDigits: 2 })
                  : "—"}
              </td>
              <td className="px-4 py-3 text-sm text-slate-600">{s.po_currency || "—"}</td>
              <td className="px-4 py-3 text-sm text-slate-600">
                {s.incoterm
                  ? `${s.incoterm}${s.incoterm_location ? ` (${s.incoterm_location})` : ""}`
                  : "—"}
              </td>
              <td className="px-4 py-3">
                <span
                  className={cn(
                    "inline-flex px-2 py-0.5 rounded text-xs font-medium",
                    s.is_active ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"
                  )}
                >
                  {s.is_active ? "Oui" : "Non"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TABS = [
  { id: "general", label: "Général" },
  { id: "tarification", label: "Tarification" },
  { id: "descriptions", label: "Descriptions" },
  { id: "fournisseurs", label: "Fournisseurs" },
];

export default function ProductPage({ params }: { params: Promise<{ sku: string }> }) {
  const { sku } = use(params);
  const decodedSku = decodeURIComponent(sku);

  const { data: product, isLoading, error } = useSWR<ProductDetail>(
    ["product", decodedSku],
    () => getProduct(decodedSku)
  );

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-500 p-10">
        <AlertCircle size={40} className="text-red-300" />
        <p className="font-medium">Produit introuvable</p>
        <p className="text-sm text-slate-400">{error?.message}</p>
        <Link
          href="/catalog"
          className="text-sm text-[#E07200] hover:text-[#C56400] font-medium mt-2"
        >
          Retour au catalogue
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-slate-500 mb-4">
        <Link href="/catalog" className="hover:text-slate-700 transition-colors">
          Catalogue
        </Link>
        {product?.universe && (
          <>
            <ChevronRight size={14} className="text-slate-400" />
            <span className="text-slate-500">{product.universe}</span>
          </>
        )}
        <ChevronRight size={14} className="text-slate-400" />
        <span className="text-slate-800 font-medium">{decodedSku}</span>
      </nav>

      {/* Header */}
      <div className="bg-white border border-[#E2E8F0] rounded-xl p-5 shadow-sm mb-6">
        {isLoading ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-96" />
          </div>
        ) : product ? (
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-bold text-slate-900 font-mono">{product.sku_code}</h1>
                {product.universe && (
                  <span
                    className={cn(
                      "inline-flex px-2 py-0.5 rounded text-xs font-semibold",
                      UNIVERSE_COLORS[product.universe] ?? "bg-slate-100 text-slate-600"
                    )}
                  >
                    {product.universe}
                  </span>
                )}
                <span
                  className={cn(
                    "inline-flex px-2 py-0.5 rounded text-xs font-semibold",
                    product.is_active ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"
                  )}
                >
                  {product.is_active ? "Actif" : "Inactif"}
                </span>
              </div>
              <p className="text-slate-600 mt-1.5">{product.name}</p>
              {product.odoo_last_sync_at && (
                <p className="text-xs text-slate-400 mt-1">
                  Dernier sync Odoo : {new Date(product.odoo_last_sync_at).toLocaleDateString("fr-FR")}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button className="flex items-center gap-2 px-3 py-2 text-sm border border-[#E2E8F0] rounded-lg hover:bg-slate-50 transition-colors text-slate-600">
                <RefreshCw size={14} />
                Recalculer PAMP
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Tabs */}
      {isLoading ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : product ? (
        <Tabs.Root defaultValue="general">
          <Tabs.List className="flex gap-0.5 bg-white border border-[#E2E8F0] rounded-xl p-1 shadow-sm mb-6 overflow-x-auto">
            {TABS.map((tab) => (
              <Tabs.Trigger
                key={tab.id}
                value={tab.id}
                className={cn(
                  "flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                  "text-slate-500 hover:text-slate-800",
                  "data-[state=active]:bg-[#E07200] data-[state=active]:text-white"
                )}
              >
                {tab.label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>

          <Tabs.Content value="general">
            <TabGeneral product={product} />
          </Tabs.Content>
          <Tabs.Content value="tarification">
            <TabTarification product={product} />
          </Tabs.Content>
          <Tabs.Content value="descriptions">
            <TabDescriptions product={product} />
          </Tabs.Content>
          <Tabs.Content value="fournisseurs">
            <TabFournisseurs suppliers={product.suppliers ?? []} />
          </Tabs.Content>
        </Tabs.Root>
      ) : null}
    </div>
  );
}
