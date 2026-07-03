"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import useSWR from "swr";
import {
  Faders,
  Package,
  SidebarSimple,
  Sparkle,
  SquaresFour,
} from "@phosphor-icons/react";
import {
  getCatalogProducts,
  getFilterableAttributes,
  type CatalogFilters,
  type PaginatedProducts,
  type Product,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/ConfirmProvider";
import { usePersistedBoolean } from "@/hooks/usePersistedBoolean";
import { useResizableWidth } from "@/hooks/useResizableWidth";
import { EmptyState } from "@/components/EmptyState";
import { SearchInput } from "@/components/SearchInput";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CatalogSidebar } from "./CatalogSidebar";
import { ActiveFilterBar } from "./ActiveFilterBar";
import { CatalogFilterSheet, CatalogFilterTrigger } from "./CatalogFilterSheet";
import { countActiveFilters } from "./active-filters";
import { useCatalogColumns } from "./catalog-columns";
import { CATALOG_COLUMN_WIDTHS_KEY } from "./useColumnWidths";
import {
  loadSavedFilters,
  normalizeCatalogFilters,
  persistSavedFilters,
  type SavedFilter,
} from "./filters-storage";
import {
  DataTable,
  cycleSortField,
  type DataTableColumnDef,
  type DataTableSortState,
} from "@/components/data-table";

const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_SORT: DataTableSortState = { field: "sku_code", dir: "asc" };

export interface CatalogBrowserProps {
  className?: string;
  /** `page` = plein écran catalogue ; `embedded` = wizard / panneau embarqué */
  variant?: "page" | "embedded";
  pageSize?: number;
  columnWidthsKey?: string;
  /** Préfixe de clé SWR (évite les collisions entre instances) */
  swrKey?: string;
  density?: "default" | "compact";
  skuAsLink?: boolean;
  extraColumns?: DataTableColumnDef<Product>[];
  filtersCollapsedStorageKey?: string;
  filtersWidthStorageKey?: string;
  paginationJumpInputId?: string;
  enableSavedFilters?: boolean;
  enabled?: boolean;

  /** Titre affiché dans la barre d'outils (variant embedded) */
  title?: string;
  /** Contenu à droite de la barre d'outils (export, nouveau produit, etc.) */
  toolbarActions?:
    | ReactNode
    | ((ctx: { filters: CatalogFilters; total: number; isLoading: boolean }) => ReactNode);
  /** Barre d'actions affichée quand des lignes sont cochées */
  selectionBar?: (ctx: { selectedIds: string[]; filters: CatalogFilters }) => ReactNode;

  selectedIds?: Set<string>;
  onToggleProduct?: (product: Product) => void;
  /** Sélection / désélection en masse de la page courante (évite les mises à jour d'état périmées). */
  onTogglePageProducts?: (products: Product[], select: boolean) => void;
  disabledRowIds?: Set<string>;
  onRowClick?: (product: Product) => void;
}

/**
 * Navigateur catalogue réutilisable — filtres, recherche, tableau paginé.
 * Source unique partagée par `/catalog`, le wizard simulation et les modales d'ajout.
 */
export function CatalogBrowser({
  className,
  variant = "page",
  pageSize = DEFAULT_PAGE_SIZE,
  columnWidthsKey = CATALOG_COLUMN_WIDTHS_KEY,
  swrKey = "catalog-products",
  density = "default",
  skuAsLink = true,
  extraColumns = [],
  filtersCollapsedStorageKey = "syskern:catalog-filters-collapsed",
  filtersWidthStorageKey = "syskern:catalog-filters-width",
  paginationJumpInputId = "catalog-page-jump",
  enableSavedFilters = true,
  enabled = true,
  title,
  toolbarActions,
  selectionBar,
  selectedIds,
  onToggleProduct,
  onTogglePageProducts,
  disabledRowIds,
  onRowClick,
}: CatalogBrowserProps) {
  const confirm = useConfirm();
  const selectionEnabled = Boolean(selectedIds && onToggleProduct);

  const [filters, setFilters] = useState<CatalogFilters>({});
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<DataTableSortState>(DEFAULT_SORT);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [filtersCollapsed, setFiltersCollapsed] = usePersistedBoolean(filtersCollapsedStorageKey, false);
  const {
    width: filterSidebarWidth,
    startResize: startFilterResize,
    isResizing: isFilterResizing,
  } = useResizableWidth(variant === "page" ? 320 : 300, {
    min: variant === "page" ? 260 : 240,
    max: variant === "page" ? 520 : 420,
    storageKey: filtersWidthStorageKey,
  });

  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>(loadSavedFilters);
  useEffect(() => {
    if (enableSavedFilters) persistSavedFilters(savedFilters);
  }, [enableSavedFilters, savedFilters]);

  const { data: filterableAttrs } = useSWR("filterable-attrs", getFilterableAttributes);
  const attrLabels = useMemo(() => {
    const m: Record<string, string> = {};
    for (const a of filterableAttrs ?? []) {
      m[a.code] = a.label.fr || a.label.en || a.code;
    }
    return m;
  }, [filterableAttrs]);

  const onSearchChange = (v: string) => {
    setSearchInput(v);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setFilters((f) => ({ ...f, q: v || undefined }));
      setPage(1);
    }, 300);
  };

  const applyFilters = useCallback((next: CatalogFilters | ((prev: CatalogFilters) => CatalogFilters)) => {
    setFilters(next);
    setPage(1);
  }, []);

  const resetFilters = () => {
    setFilters({});
    setSearchInput("");
    setPage(1);
  };

  const ordering = `${sort.dir === "desc" ? "-" : ""}${sort.field}`;
  const filtersKey = JSON.stringify(filters);
  const { data, isLoading, error } = useSWR<PaginatedProducts>(
    enabled ? [swrKey, filtersKey, ordering, page] : null,
    () => getCatalogProducts({ ...filters, ordering, page, limit: pageSize }),
    { keepPreviousData: true },
  );

  const products = data?.results ?? [];
  const total = data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const activeFilterCount = countActiveFilters(filters);
  const disabled = disabledRowIds ?? new Set<string>();

  const selectableProducts = products.filter((p) => !disabled.has(p.id));
  const allPageSelected =
    selectionEnabled &&
    selectableProducts.length > 0 &&
    selectableProducts.every((p) => selectedIds!.has(p.id));

  const toggleSelectPage = () => {
    if (!selectionEnabled) return;
    const pageProducts = products.filter((p) => !disabled.has(p.id));
    if (pageProducts.length === 0) return;

    if (onTogglePageProducts) {
      onTogglePageProducts(pageProducts, !allPageSelected);
      return;
    }

    for (const product of pageProducts) {
      const isSelected = selectedIds!.has(product.id);
      if (allPageSelected && isSelected) onToggleProduct!(product);
      if (!allPageSelected && !isSelected) onToggleProduct!(product);
    }
  };

  const handleSort = useCallback((field: string) => {
    setPage(1);
    setSort((current) => cycleSortField(field, current, DEFAULT_SORT));
  }, []);

  const handlePageChange = useCallback((nextPage: number) => {
    setPage(nextPage);
    tableScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const onSaveFilter = (name: string) => {
    if (!enableSavedFilters) return;
    const id = typeof crypto !== "undefined" ? crypto.randomUUID() : String(Date.now());
    setSavedFilters((prev) => [...prev, { id, name, filters }]);
  };
  const onApplyFilter = (sf: SavedFilter) => {
    const next = normalizeCatalogFilters(sf.filters);
    setFilters(next);
    setSearchInput(next.q ?? "");
    setPage(1);
  };
  const onDeleteFilter = useCallback(
    async (id: string) => {
      const sf = savedFilters.find((f) => f.id === id);
      if (!sf) return;
      const ok = await confirm({
        title: "Supprimer le filtre favori",
        description: `Supprimer « ${sf.name} » de vos filtres sauvegardés ?`,
        confirmLabel: "Supprimer",
        destructive: true,
      });
      if (!ok) return;
      setSavedFilters((prev) => prev.filter((f) => f.id !== id));
    },
    [confirm, savedFilters],
  );

  const emptySavedFilters = useMemo<SavedFilter[]>(() => [], []);
  const noop = useCallback(() => {}, []);

  const columns = useCatalogColumns({
    skuAsLink,
    extraColumns,
    showLanguageColumn: variant === "page",
  });

  const handleRowClick = (product: Product) => {
    if (disabled.has(product.id)) return;
    if (onRowClick) onRowClick(product);
    else if (selectionEnabled) onToggleProduct!(product);
  };

  const selectedIdList = useMemo(() => (selectedIds ? [...selectedIds] : []), [selectedIds]);

  const toolbarNode =
    typeof toolbarActions === "function"
      ? toolbarActions({ filters, total, isLoading })
      : toolbarActions;

  const rootClassName = cn(
    "flex min-h-0 overflow-hidden",
    variant === "page" ? "h-full bg-background" : "min-h-0 flex-1 rounded-xl border border-border bg-card shadow-sm",
    className,
  );

  const sidebarCollapsedClass =
    variant === "page"
      ? "relative hidden w-12 shrink-0 flex-col items-center border-r border-border bg-card py-3 shadow-[var(--shadow-soft)] lg:flex"
      : "relative hidden w-12 shrink-0 flex-col items-center border-r border-border py-3 lg:flex";

  const sidebarExpandedClass =
    variant === "page"
      ? "relative hidden shrink-0 flex-col border-r border-border bg-card shadow-[var(--shadow-soft)] lg:flex"
      : "relative hidden shrink-0 flex-col border-r border-border bg-card lg:flex";

  return (
    <div className={rootClassName}>
      {filtersCollapsed ? (
        <div className={sidebarCollapsedClass}>
          <button
            type="button"
            onClick={() => setFiltersCollapsed(false)}
            className="relative rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Afficher les filtres"
            title="Filtres"
          >
            <Faders size={18} weight="duotone" />
            {activeFilterCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>
      ) : (
        <aside className={sidebarExpandedClass} style={{ width: filterSidebarWidth }}>
          <div
            className={cn(
              "flex shrink-0 items-center justify-between gap-2 border-b border-border px-4",
              variant === "page" ? "sticky top-0 z-10 bg-card py-4" : "py-3",
            )}
          >
            <div className="min-w-0">
              <span className="text-sm font-bold text-foreground">Filtres</span>
              {variant === "page" && activeFilterCount > 0 && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {activeFilterCount} critère{activeFilterCount > 1 ? "s actifs" : " actif"}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {activeFilterCount > 0 && (
                <Button type="button" variant="ghost" size="sm" onClick={resetFilters}>
                  {variant === "page" ? "Tout effacer" : "Effacer"}
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setFiltersCollapsed(true)}
                aria-label="Masquer les filtres"
                title="Masquer les filtres"
              >
                <SidebarSimple size={18} />
              </Button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <CatalogSidebar
              filters={filters}
              onChange={applyFilters}
              savedFilters={enableSavedFilters ? savedFilters : emptySavedFilters}
              onSaveFilter={enableSavedFilters ? onSaveFilter : noop}
              onApplyFilter={enableSavedFilters ? onApplyFilter : noop}
              onDeleteFilter={enableSavedFilters ? onDeleteFilter : noop}
            />
          </div>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Redimensionner le panneau des filtres"
            onMouseDown={startFilterResize}
            className={cn(
              "absolute right-0 top-0 z-20 flex h-full w-1.5 cursor-col-resize touch-none items-center justify-center transition-colors hover:bg-primary/20",
              isFilterResizing && "bg-primary/30",
            )}
          >
            <span className="h-10 w-0.5 rounded-full bg-border" />
          </div>
        </aside>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div
          className={cn(
            "flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-4",
            variant === "page"
              ? "justify-between gap-4 bg-card py-4 shadow-[var(--shadow-soft)] sm:px-6"
              : "py-3",
          )}
        >
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <CatalogFilterTrigger
              activeCount={activeFilterCount}
              onClick={() => setMobileFiltersOpen(true)}
            />
            {variant === "page" ? (
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
            ) : (
              <div className="flex min-w-0 items-center gap-2">
                <SquaresFour size={18} weight="duotone" className="shrink-0 text-primary" />
                <span className="text-sm font-semibold text-foreground">{title ?? "Catalogue"}</span>
                {!isLoading && (
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {total.toLocaleString("fr-FR")} produit{total !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
            )}
            <SearchInput
              className={cn(
                variant === "page"
                  ? "ml-2 hidden w-72 lg:block lg:w-80"
                  : "ml-auto w-full min-w-[200px] sm:max-w-xs lg:max-w-sm",
              )}
              value={searchInput}
              onChange={onSearchChange}
              placeholder={
                variant === "page" ? "Recherche SKU, nom, description…" : "Recherche SKU, nom…"
              }
            />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {toolbarNode}
          </div>
        </div>

        <CatalogFilterSheet
          open={mobileFiltersOpen}
          onOpenChange={setMobileFiltersOpen}
          filters={filters}
          onChange={applyFilters}
          onReset={resetFilters}
          savedFilters={enableSavedFilters ? savedFilters : emptySavedFilters}
          onSaveFilter={enableSavedFilters ? onSaveFilter : noop}
          onApplyFilter={enableSavedFilters ? onApplyFilter : noop}
          onDeleteFilter={enableSavedFilters ? onDeleteFilter : noop}
        />

        <ActiveFilterBar
          filters={filters}
          attrLabels={attrLabels}
          onChange={applyFilters}
          onClearAll={resetFilters}
        />

        {variant === "page" && (
          <div className="border-b border-border bg-card px-4 py-3 md:hidden">
            <SearchInput value={searchInput} onChange={onSearchChange} placeholder="Rechercher…" />
          </div>
        )}

        {selectionBar && selectedIds && selectedIds.size > 0
          ? selectionBar({ selectedIds: selectedIdList, filters })
          : null}

        <DataTable
          scrollRef={tableScrollRef}
          className="min-h-0 flex-1"
          columns={columns}
          rows={products}
          rowKey={(p) => p.id}
          storageKey={columnWidthsKey}
          sort={sort}
          defaultSort={DEFAULT_SORT}
          onSort={handleSort}
          density={density}
          isLoading={isLoading}
          errorState={
            error ? (
              <EmptyState
                className="mx-4 my-8 border-none bg-transparent shadow-none"
                icon={<Package size={32} weight="duotone" />}
                title="Impossible de charger les produits"
                description={error.message}
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
          onRowClick={handleRowClick}
          selectedRowKeys={selectedIds}
          rowClassName={(product) => {
            if (disabled.has(product.id)) return "opacity-60";
            if (selectedIds?.has(product.id)) return "bg-primary/5";
            return "bg-card even:bg-muted/20 hover:bg-primary/5";
          }}
          renderLeadingHeader={
            selectionEnabled
              ? () => (
                  <Checkbox
                    checked={allPageSelected}
                    onCheckedChange={() => toggleSelectPage()}
                    aria-label="Tout sélectionner"
                    disabled={selectableProducts.length === 0}
                  />
                )
              : undefined
          }
          renderLeadingCell={
            selectionEnabled
              ? (product) => (
                  <Checkbox
                    checked={selectedIds!.has(product.id)}
                    onCheckedChange={() => onToggleProduct!(product)}
                    disabled={disabled.has(product.id)}
                    aria-label={`Sélectionner ${product.sku_code}`}
                    onClick={(e) => e.stopPropagation()}
                  />
                )
              : undefined
          }
          pagination={{
            page,
            totalPages,
            totalCount: total,
            pageSize,
            onPageChange: handlePageChange,
            itemLabel: "produit",
            jumpInputId: paginationJumpInputId,
            ariaLabel: "Pagination du catalogue",
          }}
        />
      </div>
    </div>
  );
}
