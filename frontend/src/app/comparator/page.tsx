"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Faders, GitDiff, Plus, SidebarSimple, Trash, X } from "@phosphor-icons/react";
import {
  deleteSavedComparison,
  getComparisonsList,
  type PaginatedComparisons,
  type SavedComparison,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/ConfirmProvider";
import { usePersistedBoolean } from "@/hooks/usePersistedBoolean";
import { useResizableWidth } from "@/hooks/useResizableWidth";
import { EmptyState } from "@/components/EmptyState";
import { SearchInput } from "@/components/SearchInput";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DataTable,
  cycleSortField,
  type DataTableColumnDef,
  type DataTableSortState,
} from "@/components/data-table";
import { ComparisonFiltersSidebar } from "./_components/ComparisonFiltersSidebar";
import { ComparisonActiveFilterBar } from "./_components/ComparisonActiveFilterBar";
import {
  ComparisonFilterSheet,
  ComparisonFilterTrigger,
} from "./_components/ComparisonFilterSheet";
import {
  countActiveComparisonFilters,
  normalizeComparisonFilters,
  toComparisonParams,
  type ComparisonFilters,
} from "./_components/comparison-filters";
import {
  loadSavedComparisonFilters,
  persistSavedComparisonFilters,
  type SavedComparisonFilter,
} from "./_components/filters-storage";

const PAGE_SIZE = 50;
const DEFAULT_SORT: DataTableSortState = { field: "updated_at", dir: "desc" };
const COLUMN_WIDTHS_KEY = "syskern:comparisons-list-col-widths:v1";

export default function ComparisonsPage() {
  const router = useRouter();
  const confirm = useConfirm();

  const [filters, setFilters] = useState<ComparisonFilters>({});
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<DataTableSortState>(DEFAULT_SORT);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [filtersCollapsed, setFiltersCollapsed] = usePersistedBoolean(
    "syskern:comparison-filters-collapsed",
    false,
  );
  const {
    width: filterSidebarWidth,
    startResize: startFilterResize,
    isResizing: isFilterResizing,
  } = useResizableWidth(300, {
    min: 240,
    max: 420,
    storageKey: "syskern:comparison-filters-width",
  });

  const [savedFilters, setSavedFilters] = useState<SavedComparisonFilter[]>(
    loadSavedComparisonFilters,
  );
  useEffect(() => {
    persistSavedComparisonFilters(savedFilters);
  }, [savedFilters]);

  const onSearchChange = (v: string) => {
    setSearchInput(v);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setFilters((f) => ({ ...f, q: v || undefined }));
      setPage(1);
    }, 300);
  };

  const ordering = `${sort.dir === "desc" ? "-" : ""}${sort.field}`;
  const filtersKey = JSON.stringify(filters);

  const { data, isLoading, error, mutate } = useSWR<PaginatedComparisons>(
    ["comparisons-list", filtersKey, ordering, page],
    () =>
      getComparisonsList({
        ...toComparisonParams(filters),
        ordering,
        page,
        limit: PAGE_SIZE,
      }),
    { keepPreviousData: true },
  );

  const comparisons = data?.results ?? [];
  const total = data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const activeFilterCount = countActiveComparisonFilters(filters);

  const applyFilters = useCallback((next: ComparisonFilters) => {
    setFilters(next);
    setPage(1);
  }, []);
  const resetFilters = () => {
    setFilters({});
    setSearchInput("");
    setPage(1);
  };

  const onSaveFilter = (name: string) => {
    const id = typeof crypto !== "undefined" ? crypto.randomUUID() : String(Date.now());
    setSavedFilters((prev) => [...prev, { id, name, filters }]);
  };
  const onApplyFilter = (sf: SavedComparisonFilter) => {
    const next = normalizeComparisonFilters(sf.filters);
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

  const pageIds = comparisons.map((c) => c.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  const toggleRow = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleSelectPage = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });

  const selectedIds = useMemo(() => [...selected], [selected]);

  const handleBulkDelete = useCallback(async () => {
    if (selected.size === 0 || bulkDeleting) return;
    const count = selected.size;
    const ok = await confirm({
      title: "Supprimer les comparaisons",
      description: `Supprimer ${count} comparaison${count !== 1 ? "s" : ""} ? Cette action est irréversible.`,
      confirmLabel: "Supprimer",
      destructive: true,
    });
    if (!ok) return;

    setBulkDeleting(true);
    try {
      await Promise.all(selectedIds.map((id) => deleteSavedComparison(id)));
      setSelected(new Set());
      await mutate();
    } finally {
      setBulkDeleting(false);
    }
  }, [bulkDeleting, confirm, mutate, selected.size, selectedIds]);

  const columns = useMemo<DataTableColumnDef<SavedComparison>[]>(
    () => [
      {
        key: "label",
        label: "Nom",
        sortField: "label",
        width: 280,
        render: (item) => (
          <div>
            <span className="text-sm font-semibold text-foreground">{item.label}</span>
            {item.note && (
              <span className="mt-0.5 line-clamp-1 block text-xs text-muted-foreground">
                {item.note}
              </span>
            )}
          </div>
        ),
      },
      {
        key: "columns",
        label: "Simulations",
        width: 320,
        render: (item) => (
          <div className="flex flex-wrap gap-1">
            {item.columns.slice(0, 4).map((col, i) => (
              <span
                key={`${col.type}-${col.id}`}
                className="max-w-[120px] truncate rounded bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                title={col.label}
              >
                {i === 0 && col.type === "simulation" ? "Réf. · " : ""}
                {col.label}
              </span>
            ))}
          </div>
        ),
      },
      {
        key: "column_count",
        label: "Colonnes",
        width: 90,
        align: "right",
        render: (item) => (
          <span className="font-data text-sm text-muted-foreground">{item.column_count}</span>
        ),
      },
      {
        key: "created_at",
        label: "Créée",
        sortField: "created_at",
        width: 120,
        render: (item) => (
          <span className="text-sm text-muted-foreground">
            {new Date(item.created_at).toLocaleDateString("fr-FR")}
          </span>
        ),
      },
      {
        key: "updated_at",
        label: "Modifiée",
        sortField: "updated_at",
        width: 120,
        render: (item) => (
          <span className="text-sm text-muted-foreground">
            {new Date(item.updated_at).toLocaleDateString("fr-FR")}
          </span>
        ),
      },
    ],
    [],
  );

  const handleSort = useCallback((field: string) => {
    setPage(1);
    setSort((current) => cycleSortField(field, current, DEFAULT_SORT));
  }, []);

  const handlePageChange = useCallback((nextPage: number) => {
    setPage(nextPage);
    tableScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  return (
    <div className="flex h-full bg-background">
      {filtersCollapsed ? (
        <div className="relative hidden w-12 shrink-0 flex-col items-center border-r border-border bg-card py-3 shadow-[var(--shadow-soft)] lg:flex">
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
        <aside
          className="relative hidden shrink-0 flex-col border-r border-border bg-card shadow-[var(--shadow-soft)] lg:flex"
          style={{ width: filterSidebarWidth }}
        >
          <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-card px-4 py-4">
            <div className="min-w-0">
              <span className="text-sm font-bold text-foreground">Filtres</span>
              {activeFilterCount > 0 && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {activeFilterCount} critère{activeFilterCount > 1 ? "s actifs" : " actif"}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {activeFilterCount > 0 && (
                <Button type="button" variant="ghost" size="sm" onClick={resetFilters}>
                  Tout effacer
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
          <div className="flex-1 overflow-y-auto overscroll-contain">
            <ComparisonFiltersSidebar
              filters={filters}
              onChange={applyFilters}
              savedFilters={savedFilters}
              onSaveFilter={onSaveFilter}
              onApplyFilter={onApplyFilter}
              onDeleteFilter={onDeleteFilter}
            />
          </div>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Redimensionner le panneau des filtres"
            onMouseDown={startFilterResize}
            className={cn(
              "absolute right-0 top-0 z-20 flex h-full w-1.5 cursor-col-resize touch-none items-center justify-center transition-colors",
              "hover:bg-primary/20",
              isFilterResizing && "bg-primary/30",
            )}
          >
            <span className="h-10 w-0.5 rounded-full bg-border" />
          </div>
        </aside>
      )}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border bg-card px-4 py-4 shadow-[var(--shadow-soft)] sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <ComparisonFilterTrigger
              activeCount={activeFilterCount}
              onClick={() => setMobileFiltersOpen(true)}
            />
            <div className="min-w-0">
              <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight text-foreground sm:text-xl">
                <GitDiff size={22} weight="duotone" className="shrink-0 text-primary" />
                Comparaisons
              </h1>
              {!isLoading && (
                <p className="mt-0.5 text-sm tabular-nums text-muted-foreground">
                  {total.toLocaleString("fr-FR")} comparaison{total !== 1 ? "s" : ""}
                </p>
              )}
            </div>
            <SearchInput
              className="ml-2 hidden w-72 lg:block lg:w-80"
              value={searchInput}
              onChange={onSearchChange}
              placeholder="Recherche nom, note…"
            />
          </div>
          <Button onClick={() => router.push("/comparator/new")}>
            <Plus size={16} />
            <span className="hidden sm:inline">Nouvelle comparaison</span>
          </Button>
        </div>

        <ComparisonFilterSheet
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

        <ComparisonActiveFilterBar
          filters={filters}
          onChange={applyFilters}
          onClearAll={resetFilters}
        />

        <div className="border-b border-border bg-card px-4 py-3 md:hidden">
          <SearchInput value={searchInput} onChange={onSearchChange} placeholder="Rechercher…" />
        </div>

        {selected.size > 0 && (
          <div className="flex shrink-0 items-center justify-between border-b border-primary/20 bg-primary/5 px-4 py-2.5 sm:px-6">
            <span className="text-sm font-semibold text-foreground">
              {selected.size} sélectionné{selected.size > 1 ? "s" : ""}
            </span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="destructive"
                disabled={bulkDeleting}
                onClick={() => void handleBulkDelete()}
              >
                <Trash size={15} />
                Supprimer la sélection
              </Button>
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
          rows={comparisons}
          rowKey={(item) => item.id}
          storageKey={COLUMN_WIDTHS_KEY}
          sort={sort}
          defaultSort={DEFAULT_SORT}
          onSort={handleSort}
          isLoading={isLoading}
          onRowClick={(item) => router.push(`/comparator/${item.id}`)}
          rowClassName={(item) =>
            selected.has(item.id) ? "bg-primary/5" : "bg-card even:bg-muted/20 hover:bg-primary/5"
          }
          renderLeadingHeader={() => (
            <Checkbox
              checked={allPageSelected}
              onCheckedChange={() => toggleSelectPage()}
              aria-label="Tout sélectionner sur la page"
            />
          )}
          renderLeadingCell={(item) => (
            <Checkbox
              checked={selected.has(item.id)}
              onCheckedChange={() => toggleRow(item.id)}
              aria-label={`Sélectionner ${item.label}`}
              onClick={(e) => e.stopPropagation()}
            />
          )}
          errorState={
            error ? (
              <EmptyState
                className="mx-4 my-8 border-none bg-transparent shadow-none"
                icon={<GitDiff size={32} weight="duotone" />}
                title="Impossible de charger les comparaisons"
                description={error.message}
              />
            ) : undefined
          }
          emptyState={
            <EmptyState
              className="mx-auto max-w-sm border-none bg-transparent shadow-none"
              icon={<GitDiff size={32} weight="duotone" />}
              title="Aucune comparaison"
              description={
                activeFilterCount > 0
                  ? "Essayez d'élargir vos filtres ou de modifier la recherche."
                  : "Créez votre première comparaison pour analyser plusieurs simulations côte à côte."
              }
              action={
                activeFilterCount > 0 ? (
                  <Button variant="outline" size="sm" onClick={resetFilters}>
                    Réinitialiser les filtres
                  </Button>
                ) : (
                  <Button onClick={() => router.push("/comparator/new")}>
                    <Plus size={16} />
                    Nouvelle comparaison
                  </Button>
                )
              }
            />
          }
          pagination={{
            page,
            totalPages,
            totalCount: total,
            pageSize: PAGE_SIZE,
            onPageChange: handlePageChange,
            itemLabel: "comparaison",
            jumpInputId: "comparisons-page-jump",
            ariaLabel: "Pagination des comparaisons",
          }}
        />
      </div>
    </div>
  );
}
