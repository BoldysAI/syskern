"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Package, Plus, Sparkle, SquaresFour, X } from "@phosphor-icons/react";
import {
  getCatalogProducts,
  getFilterableAttributes,
  type CatalogFilters,
  type PaginatedProducts,
  type Product,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { canEdit } from "@/lib/auth";
import { AddToSimulationDialog } from "@/components/AddToSimulationDialog";
import { EmptyState } from "@/components/EmptyState";
import { SearchInput } from "@/components/SearchInput";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CatalogSidebar } from "./_components/CatalogSidebar";
import { ProductDrawer } from "./_components/ProductDrawer";
import { ExportButton } from "./_components/ExportButton";
import { ActiveFilterBar } from "./_components/ActiveFilterBar";
import {
  CatalogFilterSheet,
  CatalogFilterTrigger,
} from "./_components/CatalogFilterSheet";
import { countActiveFilters } from "./_components/active-filters";
import { CATALOG_COLUMN_WIDTHS_KEY } from "./_components/useColumnWidths";
import {
  DataTable,
  cycleSortField,
  type DataTableColumnDef,
  type DataTableSortState,
} from "@/components/data-table";
import {
  loadSavedFilters,
  normalizeCatalogFilters,
  persistSavedFilters,
  type SavedFilter,
} from "./_components/filters-storage";

const PAGE_SIZE = 100;

const DEFAULT_SORT: DataTableSortState = { field: "sku_code", dir: "asc" };

function parseDec(v?: string | null): number {
  return v != null ? parseFloat(v) : 0;
}

function universeColor(universe: string): string {
  const u = universe.toUpperCase();
  if (u.includes("COPPER")) return "bg-amber-100 text-amber-800";
  if (u.includes("OPTICAL")) return "bg-blue-100 text-blue-800";
  if (u.includes("OEM")) return "bg-purple-100 text-purple-800";
  if (u.includes("RACK")) return "bg-muted text-muted-foreground";
  if (u.includes("RESIDENTIAL")) return "bg-primary/10 text-primary";
  return "bg-muted text-muted-foreground";
}

function UniverseBadge({ universe }: { universe: string }) {
  if (!universe) return <span className="text-muted-foreground/50">—</span>;
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium", universeColor(universe))}>
      {universe}
    </span>
  );
}

export default function CatalogPage() {
  const { role } = useAuth();
  const userCanEdit = canEdit(role);

  const [filters, setFilters] = useState<CatalogFilters>({});
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<DataTableSortState>(DEFAULT_SORT);
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

  const ordering = `${sort.dir === "desc" ? "-" : ""}${sort.field}`;

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
    () => getCatalogProducts({ ...filters, ordering, page, limit: PAGE_SIZE }),
    { keepPreviousData: true }
  );

  const products = data?.results ?? [];
  const total = data?.count ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const columns = useMemo<DataTableColumnDef<Product>[]>(
    () => [
      {
        key: "sku_code",
        label: "SKU",
        sortField: "sku_code",
        width: 160,
        render: (product) => (
          <Link
            href={`/catalog/${encodeURIComponent(product.sku_code)}`}
            className="font-mono text-sm font-semibold text-primary hover:text-primary/80 hover:underline"
          >
            {product.sku_code}
          </Link>
        ),
      },
      {
        key: "name",
        label: "Désignation",
        sortField: "name",
        width: 280,
        cellClassName: "text-sm text-muted-foreground truncate",
        render: (product) => product.name,
      },
      {
        key: "universe",
        label: "Univers",
        sortField: "universe",
        width: 160,
        render: (product) => <UniverseBadge universe={product.universe} />,
      },
      {
        key: "family",
        label: "Famille",
        sortField: "family",
        width: 150,
        cellClassName: "text-sm text-muted-foreground truncate",
        render: (product) => product.family || "—",
      },
      {
        key: "active_supplier",
        label: "Fournisseur actif",
        width: 170,
        cellClassName: "text-sm text-muted-foreground truncate",
        render: (product) => product.active_supplier || "—",
      },
      {
        key: "pamp_eur",
        label: "PAMP",
        sortField: "pamp_eur",
        width: 120,
        align: "right",
        cellClassName: "text-sm font-medium tabular-nums text-primary",
        render: (product) => {
          const pamp = parseDec(product.pamp_eur);
          return pamp > 0
            ? `${pamp.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
            : "—";
        },
      },
      {
        key: "stock_quantity",
        label: "Stock",
        sortField: "stock_quantity",
        width: 100,
        render: (product) => {
          const stock = parseDec(product.stock_quantity);
          return (
            <span
              className={cn(
                "inline-flex items-center gap-1 text-sm font-medium",
                stock > 0 ? "text-brand-green" : "text-muted-foreground"
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  stock > 0 ? "bg-brand-green" : "bg-muted-foreground/40"
                )}
              />
              {Math.round(stock)}
            </span>
          );
        },
      },
      {
        key: "is_active",
        label: "Actif",
        width: 80,
        render: (product) => (
          <StatusBadge variant={product.is_active ? "success" : "draft"}>
            {product.is_active ? "Oui" : "Non"}
          </StatusBadge>
        ),
      },
    ],
    []
  );

  const handleSort = useCallback((field: string) => {
    setPage(1);
    setSort((current) => cycleSortField(field, current, DEFAULT_SORT));
  }, []);

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

  return (
    <div className="flex h-full bg-surface">
      {/* Filters sidebar — desktop */}
      <aside className="hidden lg:flex w-80 flex-shrink-0 flex-col border-r border-border bg-card shadow-[var(--shadow-soft)]">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-gradient-to-b from-card to-muted/30 px-4 py-4 backdrop-blur-sm">
          <div>
            <span className="text-sm font-bold text-foreground">Filtres</span>
            {activeFilterCount > 0 && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {activeFilterCount} critère{activeFilterCount > 1 ? "s" : ""} actif
                {activeFilterCount > 1 ? "s" : ""}
              </p>
            )}
          </div>
          {activeFilterCount > 0 && (
            <Button type="button" variant="ghost" size="sm" onClick={resetFilters}>
              Tout effacer
            </Button>
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
        <div className="flex-shrink-0 flex items-center justify-between gap-4 border-b border-border bg-card px-4 py-4 shadow-[var(--shadow-soft)] sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <CatalogFilterTrigger
              activeCount={activeFilterCount}
              onClick={() => setMobileFiltersOpen(true)}
            />
            <div className="min-w-0">
              <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight text-foreground sm:text-xl">
                <SquaresFour size={22} weight="duotone" className="shrink-0 text-primary" />
                Catalogue produits
              </h1>
              {!isLoading && (
                <p className="mt-0.5 text-sm tabular-nums text-muted-foreground">
                  {total.toLocaleString("fr-FR")} produit{total !== 1 ? "s" : ""}
                </p>
              )}
            </div>
            <SearchInput
              className="ml-2 hidden w-72 lg:block lg:w-80"
              value={searchInput}
              onChange={onSearchChange}
              placeholder="Recherche SKU, nom, description…"
            />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ExportButton filters={filters} disabled={total === 0} />
            {userCanEdit && (
              <Button nativeButton={false} render={<Link href="/catalog/new" />} title="Créer un produit">
                <Plus size={16} weight="bold" />
                <span className="hidden sm:inline">Nouveau produit</span>
              </Button>
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
        <div className="border-b border-border bg-card px-4 py-3 md:hidden">
          <SearchInput
            value={searchInput}
            onChange={onSearchChange}
            placeholder="Rechercher…"
          />
        </div>

        {/* Bulk action bar */}
        {selected.size > 0 && (
          <div className="flex shrink-0 items-center justify-between border-b border-primary/20 bg-primary/5 px-4 py-2.5 sm:px-6">
            <span className="text-sm font-semibold text-foreground">
              {selected.size} sélectionné{selected.size > 1 ? "s" : ""}
            </span>
            <div className="flex items-center gap-2">
              <ExportButton filters={filters} selectedIds={selectedIds} />
              <AddToSimulationDialog
                productIds={selectedIds}
                productLabel={`${selected.size} produit${selected.size > 1 ? "s" : ""}`}
                onAdded={() => setSelected(new Set())}
              >
                <Button size="sm">
                  <Plus size={15} weight="bold" />
                  Ajouter à simulation
                </Button>
              </AddToSimulationDialog>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setSelected(new Set())}
                title="Vider la sélection"
                aria-label="Vider la sélection"
              >
                <X size={16} weight="bold" />
              </Button>
            </div>
          </div>
        )}

        <DataTable
          scrollRef={tableScrollRef}
          columns={columns}
          rows={products}
          rowKey={(p) => p.id}
          storageKey={CATALOG_COLUMN_WIDTHS_KEY}
          sort={sort}
          defaultSort={DEFAULT_SORT}
          onSort={handleSort}
          isLoading={isLoading}
          errorState={
            error ? (
              <EmptyState
                className="mx-4 my-8 border-none bg-transparent shadow-none"
                icon={<Package size={32} weight="duotone" />}
                title="Impossible de charger les produits"
                description={error?.message}
              />
            ) : undefined
          }
          emptyState={
            <EmptyState
              className="mx-auto max-w-sm border-none bg-transparent shadow-none"
              icon={<Package size={32} weight="duotone" />}
              title="Aucun produit trouvé"
              description={
                activeFilterCount > 0
                  ? "Essayez d'élargir vos filtres ou de modifier la recherche."
                  : "Le catalogue est vide ou les produits ne sont pas encore synchronisés."
              }
              action={
                activeFilterCount > 0 ? (
                  <Button variant="outline" size="sm" onClick={resetFilters}>
                    <Sparkle size={14} weight="duotone" />
                    Réinitialiser les filtres
                  </Button>
                ) : undefined
              }
            />
          }
          onRowClick={(product) => setDrawerSku(product.sku_code)}
          rowClassName={(product) =>
            selected.has(product.id)
              ? "bg-primary/5"
              : "bg-card even:bg-muted/20 hover:bg-primary/5"
          }
          renderLeadingHeader={() => (
            <Checkbox
              checked={allPageSelected}
              onCheckedChange={() => toggleSelectPage()}
              aria-label="Tout sélectionner"
            />
          )}
          renderLeadingCell={(product) => (
            <Checkbox
              checked={selected.has(product.id)}
              onCheckedChange={() => toggleRow(product.id)}
              aria-label={`Sélectionner ${product.sku_code}`}
              onClick={(e) => e.stopPropagation()}
            />
          )}
          pagination={{
            page,
            totalPages,
            totalCount: total,
            pageSize: PAGE_SIZE,
            onPageChange: handlePageChange,
            itemLabel: "produit",
            jumpInputId: "catalog-page-jump",
            ariaLabel: "Pagination du catalogue",
          }}
        />
      </div>

      <ProductDrawer sku={drawerSku} onClose={() => setDrawerSku(null)} />
    </div>
  );
}
