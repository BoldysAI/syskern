"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import {
  Search,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Package,
  Plus,
  X,
  Sparkles,
} from "lucide-react";
import {
  getProducts,
  getFilterableAttributes,
  type CatalogFilters,
  type PaginatedProducts,
  type Product,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { canEdit } from "@/lib/auth";
import { AddToSimulationDialog } from "@/components/AddToSimulationDialog";
import { CatalogSidebar } from "./_components/CatalogSidebar";
import { ProductDrawer } from "./_components/ProductDrawer";
import { ExportButton } from "./_components/ExportButton";
import { CatalogPagination } from "./_components/CatalogPagination";
import { ActiveFilterBar } from "./_components/ActiveFilterBar";
import {
  CatalogFilterSheet,
  CatalogFilterTrigger,
} from "./_components/CatalogFilterSheet";
import { countActiveFilters } from "./_components/active-filters";
import { useColumnWidths } from "./_components/useColumnWidths";
import {
  loadSavedFilters,
  normalizeCatalogFilters,
  persistSavedFilters,
  type SavedFilter,
} from "./_components/filters-storage";

const PAGE_SIZE = 100;

type SortField = "sku_code" | "name" | "universe" | "family" | "pamp_eur" | "stock_quantity";
type SortDir = "asc" | "desc";

interface ColumnDef {
  key: string;
  label: string;
  sortField?: SortField;
  width: number;
}

const COLUMNS: ColumnDef[] = [
  { key: "sku_code", label: "SKU", sortField: "sku_code", width: 160 },
  { key: "name", label: "Désignation", sortField: "name", width: 280 },
  { key: "universe", label: "Univers", sortField: "universe", width: 160 },
  { key: "family", label: "Famille", sortField: "family", width: 150 },
  { key: "active_supplier", label: "Fournisseur actif", width: 170 },
  { key: "pamp_eur", label: "PAMP", sortField: "pamp_eur", width: 120 },
  { key: "stock_quantity", label: "Stock", sortField: "stock_quantity", width: 100 },
  { key: "is_active", label: "Actif", width: 80 },
];

const DEFAULT_WIDTHS = Object.fromEntries(COLUMNS.map((c) => [c.key, c.width]));

const DEFAULT_SORT_FIELD: SortField = "sku_code";
const DEFAULT_SORT_DIR: SortDir = "asc";

function isDefaultSort(field: SortField, dir: SortDir): boolean {
  return field === DEFAULT_SORT_FIELD && dir === DEFAULT_SORT_DIR;
}

function parseDec(v?: string | null): number {
  return v != null ? parseFloat(v) : 0;
}

function universeColor(universe: string): string {
  const u = universe.toUpperCase();
  if (u.includes("COPPER")) return "bg-amber-100 text-amber-800";
  if (u.includes("OPTICAL")) return "bg-blue-100 text-blue-800";
  if (u.includes("OEM")) return "bg-purple-100 text-purple-800";
  if (u.includes("RACK")) return "bg-slate-100 text-slate-700";
  if (u.includes("RESIDENTIAL")) return "bg-green-100 text-green-700";
  return "bg-slate-100 text-slate-600";
}

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse bg-slate-200 rounded", className)} />;
}

function UniverseBadge({ universe }: { universe: string }) {
  if (!universe) return <span className="text-slate-300">—</span>;
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium", universeColor(universe))}>
      {universe}
    </span>
  );
}

function SortIcon({
  active,
  dir,
}: {
  active: boolean;
  dir: SortDir;
}) {
  if (!active) return <ChevronsUpDown size={13} className="text-slate-400 shrink-0" />;
  return dir === "asc" ? (
    <ChevronUp size={13} className="text-orange-500 shrink-0" />
  ) : (
    <ChevronDown size={13} className="text-orange-500 shrink-0" />
  );
}

export default function CatalogPage() {
  const { role } = useAuth();
  const userCanEdit = canEdit(role);

  const [filters, setFilters] = useState<CatalogFilters>({});
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const [sortField, setSortField] = useState<SortField>(DEFAULT_SORT_FIELD);
  const [sortDir, setSortDir] = useState<SortDir>(DEFAULT_SORT_DIR);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawerSku, setDrawerSku] = useState<string | null>(null);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const tableScrollRef = useRef<HTMLDivElement>(null);

  const { data: filterableAttrs } = useSWR("filterable-attrs", getFilterableAttributes);
  const attrLabels = useMemo(() => {
    const m: Record<string, string> = {};
    for (const a of filterableAttrs ?? []) {
      m[a.code] = a.label.fr || a.label.en || a.code;
    }
    return m;
  }, [filterableAttrs]);

  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>(loadSavedFilters);
  useEffect(() => {
    persistSavedFilters(savedFilters);
  }, [savedFilters]);

  const ordering = `${sortDir === "desc" ? "-" : ""}${sortField}`;
  const { widths, startResize, resizingKey } = useColumnWidths(DEFAULT_WIDTHS);

  // Debounced full-text search → filters.q (no setState directly in an effect).
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSearchChange = (v: string) => {
    setSearchInput(v);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setFilters((f) => ({ ...f, q: v || undefined }));
      setPage(1);
    }, 300);
  };

  const filtersKey = JSON.stringify(filters);
  const { data, isLoading, error } = useSWR<PaginatedProducts>(
    ["products", filtersKey, ordering, page],
    () => getProducts({ ...filters, ordering, page, limit: PAGE_SIZE }),
    { keepPreviousData: true }
  );

  const products = data?.results ?? [];
  const total = data?.count ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  /** Tri cyclique : croissant → décroissant → tri par défaut (SKU ↑). */
  const handleSort = useCallback(
    (field: SortField) => {
      setPage(1);
      if (sortField === field) {
        if (sortDir === "asc") {
          setSortDir("desc");
        } else {
          setSortField(DEFAULT_SORT_FIELD);
          setSortDir(DEFAULT_SORT_DIR);
        }
      } else {
        setSortField(field);
        setSortDir("asc");
      }
    },
    [sortField, sortDir]
  );

  const applyFilters = (next: CatalogFilters) => {
    setFilters(next);
    setPage(1);
  };

  const resetFilters = () => {
    setFilters({});
    setSearchInput("");
    setPage(1);
  };

  const toggleRow = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const pageIds = products.map((p) => p.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const toggleSelectPage = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });

  const selectedIds = useMemo(() => [...selected], [selected]);

  const onSaveFilter = (name: string) => {
    const id = typeof crypto !== "undefined" ? crypto.randomUUID() : String(Date.now());
    setSavedFilters((prev) => [...prev, { id, name, filters }]);
  };
  const onApplyFilter = (sf: SavedFilter) => {
    const next = normalizeCatalogFilters(sf.filters);
    setFilters(next);
    setSearchInput(next.q ?? "");
    setPage(1);
  };
  const onDeleteFilter = (id: string) =>
    setSavedFilters((prev) => prev.filter((f) => f.id !== id));

  const handlePageChange = useCallback((nextPage: number) => {
    setPage(nextPage);
    tableScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const activeFilterCount = countActiveFilters(filters);

  const thClass =
    "px-4 py-3.5 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap select-none";

  const searchInputCls =
    "w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50/80 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/25 focus:border-orange-500 focus:bg-white transition-all";

  return (
    <div className="flex h-full bg-surface">
      {/* Filters sidebar — desktop */}
      <aside className="hidden lg:flex flex-col w-80 flex-shrink-0 bg-white border-r border-slate-200 shadow-sm">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 px-4 py-4 border-b border-slate-200 bg-gradient-to-b from-white to-slate-50/80 backdrop-blur-sm">
          <div>
            <span className="text-sm font-bold text-slate-900">Filtres</span>
            {activeFilterCount > 0 && (
              <p className="text-xs text-slate-500 mt-0.5">
                {activeFilterCount} critère{activeFilterCount > 1 ? "s" : ""} actif
                {activeFilterCount > 1 ? "s" : ""}
              </p>
            )}
          </div>
          {activeFilterCount > 0 && (
            <button
              type="button"
              className="text-xs font-semibold text-orange-600 hover:text-orange-700 px-2 py-1 rounded-md hover:bg-orange-50 transition-colors"
              onClick={resetFilters}
            >
              Tout effacer
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain">
          <CatalogSidebar
            filters={filters}
            onChange={applyFilters}
            savedFilters={savedFilters}
            onSaveFilter={onSaveFilter}
            onApplyFilter={onApplyFilter}
            onDeleteFilter={onDeleteFilter}
          />
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Toolbar */}
        <div className="flex-shrink-0 flex items-center justify-between gap-4 px-4 sm:px-6 py-4 bg-white border-b border-slate-200 shadow-sm">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <CatalogFilterTrigger
              activeCount={activeFilterCount}
              onClick={() => setMobileFiltersOpen(true)}
            />
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight">
                Catalogue produits
              </h1>
              {!isLoading && (
                <p className="text-sm text-slate-500 mt-0.5 tabular-nums">
                  {total.toLocaleString("fr-FR")} produit{total !== 1 ? "s" : ""}
                </p>
              )}
            </div>
            <div className="relative hidden md:block w-72 lg:w-80 ml-2">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
              />
              <input
                type="search"
                placeholder="Recherche SKU, nom, description…"
                value={searchInput}
                onChange={(e) => onSearchChange(e.target.value)}
                className={searchInputCls}
              />
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <ExportButton filters={filters} disabled={total === 0} />
            {userCanEdit && (
              <Link
                href="/catalog/new"
                className="flex items-center gap-2 h-9 px-4 text-sm font-semibold text-white bg-orange-500 rounded-lg hover:bg-orange-600 transition-colors shadow-sm"
                title="Créer un produit"
              >
                <Plus size={15} />
                <span className="hidden sm:inline">Nouveau produit</span>
              </Link>
            )}
          </div>
        </div>

        <CatalogFilterSheet
          open={mobileFiltersOpen}
          onOpenChange={setMobileFiltersOpen}
          filters={filters}
          onChange={applyFilters}
          onReset={resetFilters}
          savedFilters={savedFilters}
          onSaveFilter={onSaveFilter}
          onApplyFilter={onApplyFilter}
          onDeleteFilter={onDeleteFilter}
        />

        <ActiveFilterBar
          filters={filters}
          attrLabels={attrLabels}
          onChange={applyFilters}
          onClearAll={resetFilters}
        />

        {/* Mobile search */}
        <div className="md:hidden px-4 py-3 bg-white border-b border-slate-200">
          <div className="relative">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
            />
            <input
              type="search"
              placeholder="Rechercher…"
              value={searchInput}
              onChange={(e) => onSearchChange(e.target.value)}
              className={searchInputCls}
            />
          </div>
        </div>

        {/* Bulk action bar */}
        {selected.size > 0 && (
          <div className="flex-shrink-0 flex items-center justify-between px-4 sm:px-6 py-2.5 bg-orange-50 border-b border-orange-200/80">
            <span className="text-sm font-semibold text-orange-800">
              {selected.size} sélectionné{selected.size > 1 ? "s" : ""}
            </span>
            <div className="flex items-center gap-2">
              <ExportButton filters={filters} selectedIds={selectedIds} />
              <AddToSimulationDialog
                productIds={selectedIds}
                productLabel={`${selected.size} produit${selected.size > 1 ? "s" : ""}`}
                onAdded={() => setSelected(new Set())}
              >
                <button className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-[#E07200] rounded-lg hover:bg-[#C56400] transition-colors">
                  <Plus size={15} />
                  Ajouter à simulation
                </button>
              </AddToSimulationDialog>
              <button
                onClick={() => setSelected(new Set())}
                className="p-2 text-slate-500 hover:text-slate-700"
                title="Vider la sélection"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        )}

        {/* Table */}
        <div ref={tableScrollRef} className="flex-1 overflow-auto">
          {error ? (
            <div className="flex flex-col items-center justify-center h-64 gap-3 text-slate-500">
              <Package size={40} className="text-slate-300" />
              <p className="text-sm">Impossible de charger les produits.</p>
              <p className="text-xs text-slate-400">{error?.message}</p>
            </div>
          ) : (
            <table className="border-collapse table-fixed" style={{ width: "max-content", minWidth: "100%" }}>
              <colgroup>
                <col style={{ width: 44 }} />
                {COLUMNS.map((c) => (
                  <col key={c.key} style={{ width: widths[c.key] }} />
                ))}
              </colgroup>
              <thead className="sticky top-0 bg-slate-100/95 backdrop-blur-sm border-b border-slate-200 z-10 shadow-sm">
                <tr>
                  <th className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={allPageSelected}
                      onChange={toggleSelectPage}
                      className="w-4 h-4 rounded border-slate-300 accent-[#E07200]"
                      aria-label="Tout sélectionner"
                    />
                  </th>
                  {COLUMNS.map((c) => {
                    const sortable = !!c.sortField;
                    const isActive =
                      sortable && sortField === c.sortField && !isDefaultSort(sortField, sortDir);
                    const showDefaultActive =
                      sortable &&
                      c.sortField === DEFAULT_SORT_FIELD &&
                      isDefaultSort(sortField, sortDir);
                    const showSortState = isActive || showDefaultActive;

                    return (
                      <th
                        key={c.key}
                        className={cn(thClass, "relative group select-none p-0")}
                        style={{ width: widths[c.key], minWidth: widths[c.key] }}
                      >
                        <div className="flex items-stretch h-full min-h-[44px]">
                          {sortable ? (
                            <button
                              type="button"
                              onClick={() => handleSort(c.sortField!)}
                              className={cn(
                                "flex flex-1 items-center gap-1 px-4 py-3.5 text-left min-w-0",
                                "hover:text-slate-800 transition-colors",
                                showSortState && "text-slate-800"
                              )}
                              title="Trier : croissant, décroissant, puis défaut"
                            >
                              <span className="truncate">{c.label}</span>
                              <SortIcon
                                active={showSortState}
                                dir={sortField === c.sortField ? sortDir : DEFAULT_SORT_DIR}
                              />
                            </button>
                          ) : (
                            <span className="flex flex-1 items-center px-4 py-3.5 truncate">
                              {c.label}
                            </span>
                          )}
                          <span
                            role="separator"
                            aria-orientation="vertical"
                            aria-label={`Redimensionner la colonne ${c.label}`}
                            onMouseDown={(e) => startResize(c.key, e)}
                            className={cn(
                              "relative z-20 w-3 shrink-0 cursor-col-resize touch-none",
                              "flex items-center justify-center",
                              resizingKey === c.key
                                ? "bg-orange-200/70"
                                : "hover:bg-orange-100/80 opacity-60 group-hover:opacity-100"
                            )}
                          >
                            <span
                              className={cn(
                                "w-0.5 h-5 rounded-full transition-colors",
                                resizingKey === c.key ? "bg-orange-500" : "bg-slate-300"
                              )}
                            />
                          </span>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0]">
                {isLoading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <tr key={i} className="bg-white">
                      <td className="px-3 py-3">
                        <Skeleton className="h-4 w-4" />
                      </td>
                      {COLUMNS.map((c) => (
                        <td
                          key={c.key}
                          className="px-4 py-3 overflow-hidden"
                          style={{ width: widths[c.key], maxWidth: widths[c.key] }}
                        >
                          <Skeleton className="h-4 w-full" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : products.length === 0 ? (
                  <tr>
                    <td colSpan={COLUMNS.length + 1} className="py-24 text-center">
                      <div className="flex flex-col items-center gap-3 max-w-sm mx-auto">
                        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-300">
                          <Package size={28} />
                        </span>
                        <p className="text-base font-semibold text-slate-700">Aucun produit trouvé</p>
                        <p className="text-sm text-slate-500">
                          {activeFilterCount > 0
                            ? "Essayez d'élargir vos filtres ou de modifier la recherche."
                            : "Le catalogue est vide ou les produits ne sont pas encore synchronisés."}
                        </p>
                        {activeFilterCount > 0 && (
                          <button
                            type="button"
                            onClick={resetFilters}
                            className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-orange-600 hover:text-orange-700"
                          >
                            <Sparkles size={14} />
                            Réinitialiser les filtres
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  products.map((product: Product) => {
                    const pamp = parseDec(product.pamp_eur);
                    const stock = parseDec(product.stock_quantity);
                    const isSel = selected.has(product.id);
                    return (
                      <tr
                        key={product.id}
                        className={cn(
                          "cursor-pointer transition-colors border-b border-slate-100",
                          isSel ? "bg-orange-50/90" : "bg-white even:bg-slate-50/40 hover:bg-orange-50/50"
                        )}
                        onClick={() => setDrawerSku(product.sku_code)}
                      >
                        <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSel}
                            onChange={() => toggleRow(product.id)}
                            className="w-4 h-4 rounded border-slate-300 accent-[#E07200]"
                            aria-label={`Sélectionner ${product.sku_code}`}
                          />
                        </td>
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <Link
                            href={`/catalog/${encodeURIComponent(product.sku_code)}`}
                            className="font-mono text-sm font-semibold text-orange-600 hover:text-orange-700 hover:underline"
                          >
                            {product.sku_code}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-700 truncate overflow-hidden">
                          {product.name}
                        </td>
                        <td className="px-4 py-3">
                          <UniverseBadge universe={product.universe} />
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600 truncate">
                          {product.family || "—"}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600 truncate">
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
                              stock > 0 ? "text-green-600" : "text-slate-400"
                            )}
                          >
                            <span
                              className={cn(
                                "w-1.5 h-1.5 rounded-full",
                                stock > 0 ? "bg-green-500" : "bg-slate-300"
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
                                : "bg-slate-100 text-slate-500"
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

        {!isLoading && (
          <CatalogPagination
            page={page}
            totalPages={totalPages}
            totalCount={total}
            pageSize={PAGE_SIZE}
            onPageChange={handlePageChange}
          />
        )}
      </div>

      <ProductDrawer sku={drawerSku} onClose={() => setDrawerSku(null)} />
    </div>
  );
}
