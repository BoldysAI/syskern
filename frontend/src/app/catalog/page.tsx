"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import {
  Search,
  Download,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Package,
  Loader2,
} from "lucide-react";
import { getProducts, getUniverses, exportProducts, type PaginatedProducts } from "@/lib/api";
import { cn } from "@/lib/utils";

function parseDec(v?: string | null): number {
  return v != null ? parseFloat(v) : 0;
}

// Real DB universe values can be long (e.g. "RACKS & ACCESSORIES CABINET"),
// so colour by keyword match rather than exact equality.
function universeColor(universe: string): string {
  const u = universe.toUpperCase();
  if (u.includes("COPPER")) return "bg-amber-100 text-amber-800";
  if (u.includes("OPTICAL")) return "bg-blue-100 text-blue-800";
  if (u.includes("OEM")) return "bg-purple-100 text-purple-800";
  if (u.includes("RACK")) return "bg-slate-100 text-slate-700";
  if (u.includes("RESIDENTIAL")) return "bg-green-100 text-green-700";
  return "bg-slate-100 text-slate-600";
}

type SortField = "sku_code" | "name" | "universe" | "family" | "pamp_eur" | "stock_quantity";
type SortDir = "asc" | "desc";

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse bg-slate-200 rounded", className)} />;
}

function UniverseBadge({ universe }: { universe: string }) {
  if (!universe) return <span className="text-slate-300">—</span>;
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
        universeColor(universe),
      )}
    >
      {universe}
    </span>
  );
}

function SortIcon({
  field,
  sortField,
  sortDir,
}: {
  field: string;
  sortField: string;
  sortDir: SortDir;
}) {
  if (sortField !== field) return <ChevronsUpDown size={13} className="text-slate-400" />;
  return sortDir === "asc" ? (
    <ChevronUp size={13} className="text-[#E07200]" />
  ) : (
    <ChevronDown size={13} className="text-[#E07200]" />
  );
}

export default function CatalogPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [selectedUniverses, setSelectedUniverses] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [sortField, setSortField] = useState<SortField>("sku_code");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const { data: universes } = useSWR<string[]>("universes", getUniverses);

  const { data, isLoading, error } = useSWR<PaginatedProducts>(
    ["products", search, selectedUniverses.join(","), page],
    () =>
      getProducts({
        search: search || undefined,
        universe: selectedUniverses.length ? selectedUniverses.join(",") : undefined,
        page,
        limit: 20,
      }),
    { keepPreviousData: true },
  );

  const handleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortField(field);
        setSortDir("asc");
      }
    },
    [sortField],
  );

  const toggleUniverse = (u: string) => {
    setSelectedUniverses((prev) => (prev.includes(u) ? prev.filter((x) => x !== u) : [...prev, u]));
    setPage(1);
  };

  const [isExporting, setIsExporting] = useState(false);
  const handleExport = async () => {
    setIsExporting(true);
    try {
      await exportProducts({
        search: search || undefined,
        universe: selectedUniverses.length ? selectedUniverses.join(",") : undefined,
      });
    } catch (e) {
      alert(e instanceof Error ? e.message : "Export échoué");
    } finally {
      setIsExporting(false);
    }
  };

  const products = data?.results ?? [];
  const total = data?.count ?? 0;
  const totalPages = Math.ceil(total / 20);

  const sortedProducts = [...products].sort((a, b) => {
    const av = a[sortField] ?? "";
    const bv = b[sortField] ?? "";
    const cmp = String(av).localeCompare(String(bv), undefined, {
      numeric: true,
    });
    return sortDir === "asc" ? cmp : -cmp;
  });

  const thClass =
    "px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap cursor-pointer select-none hover:text-slate-700 transition-colors";

  return (
    <div className="flex h-full">
      {/* Filters sidebar */}
      <aside className="hidden lg:flex flex-col w-64 flex-shrink-0 bg-white border-r border-[#E2E8F0] overflow-y-auto">
        <div className="p-4 border-b border-[#E2E8F0]">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-semibold text-slate-700">Filtres</span>
            {(selectedUniverses.length > 0 || search) && (
              <button
                className="text-xs text-[#E07200] hover:text-[#C56400] font-medium"
                onClick={() => {
                  setSelectedUniverses([]);
                  setSearch("");
                  setPage(1);
                }}
              >
                Réinitialiser
              </button>
            )}
          </div>
          {total > 0 && (
            <span className="text-xs text-slate-400">
              {total} produit{total > 1 ? "s" : ""}
            </span>
          )}
        </div>

        <div className="p-4 border-b border-[#E2E8F0]">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-2">
            Recherche
          </label>
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="SKU, désignation..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-full pl-8 pr-3 py-2 text-sm border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#E07200]/30 focus:border-[#E07200]"
            />
          </div>
        </div>

        <div className="p-4">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-3">
            Univers
          </label>
          <div className="flex flex-col gap-2">
            {(universes ?? []).map((u) => (
              <label key={u} className="flex items-center gap-2.5 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={selectedUniverses.includes(u)}
                  onChange={() => toggleUniverse(u)}
                  className="w-4 h-4 rounded border-slate-300 text-[#E07200] accent-[#E07200] flex-shrink-0"
                />
                <span className="text-sm text-slate-600 group-hover:text-slate-900 transition-colors">
                  {u}
                </span>
              </label>
            ))}
            {!universes && <span className="text-xs text-slate-400">Chargement…</span>}
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Toolbar */}
        <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 bg-white border-b border-[#E2E8F0]">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Catalogue produits</h1>
            {!isLoading && (
              <p className="text-sm text-slate-500 mt-0.5">
                {total} produit{total !== 1 ? "s" : ""}
              </p>
            )}
          </div>
          <button
            onClick={handleExport}
            disabled={isExporting || total === 0}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-[#E2E8F0] rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Exporter en Excel"
          >
            {isExporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
            <span className="hidden sm:inline">{isExporting ? "Export…" : "Exporter"}</span>
          </button>
        </div>

        {/* Mobile search */}
        <div className="lg:hidden px-4 py-3 bg-white border-b border-[#E2E8F0]">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Rechercher..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-full pl-8 pr-3 py-2 text-sm border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#E07200]/30 focus:border-[#E07200]"
            />
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          {error ? (
            <div className="flex flex-col items-center justify-center h-64 gap-3 text-slate-500">
              <Package size={40} className="text-slate-300" />
              <p className="text-sm">Impossible de charger les produits.</p>
              <p className="text-xs text-slate-400">{error?.message}</p>
            </div>
          ) : (
            <table className="w-full border-collapse">
              <thead className="sticky top-0 bg-[#F5F7FA] border-b border-[#E2E8F0] z-10">
                <tr>
                  {(
                    [
                      { key: "sku_code", label: "SKU" },
                      { key: "name", label: "Désignation" },
                      { key: "universe", label: "Univers" },
                      { key: "family", label: "Famille" },
                      {
                        key: "supplier",
                        label: "Fournisseur actif",
                        noSort: true,
                      },
                      { key: "pamp_eur", label: "PAMP" },
                      { key: "stock_quantity", label: "Stock" },
                      { key: "active", label: "Actif", noSort: true },
                    ] as { key: string; label: string; noSort?: boolean }[]
                  ).map(({ key, label, noSort }) => (
                    <th
                      key={key}
                      className={thClass}
                      onClick={noSort ? undefined : () => handleSort(key as SortField)}
                    >
                      <span className="flex items-center gap-1">
                        {label}
                        {!noSort && (
                          <SortIcon field={key} sortField={sortField} sortDir={sortDir} />
                        )}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0]">
                {isLoading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <tr key={i} className="bg-white">
                      {Array.from({ length: 8 }).map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <Skeleton className="h-4 w-full" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : sortedProducts.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-20 text-center text-slate-400">
                      <Package size={40} className="mx-auto mb-3 text-slate-200" />
                      <p className="text-sm">Aucun produit trouvé</p>
                    </td>
                  </tr>
                ) : (
                  sortedProducts.map((product) => {
                    const pamp = parseDec(product.pamp_eur);
                    const stock = parseDec(product.stock_quantity);
                    return (
                      <tr
                        key={product.sku_code}
                        className="bg-white hover:bg-[#FFF3E0] cursor-pointer transition-colors"
                        onClick={() =>
                          router.push(`/catalog/${encodeURIComponent(product.sku_code)}`)
                        }
                      >
                        <td className="px-4 py-3 font-mono text-sm font-semibold text-slate-800">
                          {product.sku_code}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-700 max-w-xs truncate">
                          {product.name}
                        </td>
                        <td className="px-4 py-3">
                          <UniverseBadge universe={product.universe} />
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600">
                          {product.family || "—"}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600">
                          {product.active_supplier || "—"}
                        </td>
                        <td className="px-4 py-3 text-sm font-medium text-slate-800">
                          {pamp > 0
                            ? `${pamp.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
                            : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 text-sm font-medium",
                              stock > 0 ? "text-green-600" : "text-slate-400",
                            )}
                          >
                            <span
                              className={cn(
                                "w-1.5 h-1.5 rounded-full",
                                stock > 0 ? "bg-green-500" : "bg-slate-300",
                              )}
                            />
                            {Math.round(stock)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={cn(
                              "inline-flex px-2 py-0.5 rounded text-xs font-medium",
                              product.is_active
                                ? "bg-green-100 text-green-700"
                                : "bg-slate-100 text-slate-500",
                            )}
                          >
                            {product.is_active ? "Oui" : "Non"}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {!isLoading && totalPages > 1 && (
          <div className="flex-shrink-0 flex items-center justify-between px-6 py-3 bg-white border-t border-[#E2E8F0]">
            <span className="text-sm text-slate-500">
              Page {page} sur {totalPages}
            </span>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-3 py-1.5 text-sm border border-[#E2E8F0] rounded-lg disabled:opacity-40 hover:bg-slate-50 transition-colors"
              >
                Précédent
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="px-3 py-1.5 text-sm border border-[#E2E8F0] rounded-lg disabled:opacity-40 hover:bg-slate-50 transition-colors"
              >
                Suivant
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
