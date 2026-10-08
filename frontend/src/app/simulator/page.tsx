"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import {
  Plus,
  Calculator,
  Clock,
  SealCheck,
  Archive,
  GitDiff,
  Faders,
  SidebarSimple,
  X,
  Sparkle,
} from "@phosphor-icons/react";
import {
  getSimulationsList,
  type PaginatedSimulations,
  type Simulation,
  type SimulationFilters,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { useUiTranslate } from "@/lib/use-ui-translate";
import { useConfirm } from "@/components/ConfirmProvider";
import { usePersistedBoolean } from "@/hooks/usePersistedBoolean";
import { useResizableWidth } from "@/hooks/useResizableWidth";
import { EmptyState } from "@/components/EmptyState";
import { SearchInput } from "@/components/SearchInput";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DataTable,
  cycleSortField,
  type DataTableColumnDef,
  type DataTableSortState,
} from "@/components/data-table";
import { SimulationFiltersSidebar } from "./_components/SimulationFiltersSidebar";
import { SimulationActiveFilterBar } from "./_components/SimulationActiveFilterBar";
import {
  SimulationFilterSheet,
  SimulationFilterTrigger,
} from "./_components/SimulationFilterSheet";
import {
  countActiveSimulationFilters,
  normalizeSimulationFilters,
} from "./_components/simulation-filters";
import {
  loadSavedSimulationFilters,
  persistSavedSimulationFilters,
  type SavedSimulationFilter,
} from "./_components/filters-storage";

const PAGE_SIZE = 50;
const MAX_COMPARE = 4;
const DEFAULT_SORT: DataTableSortState = { field: "updated_at", dir: "desc" };
const COLUMN_WIDTHS_KEY = "syskern:simulations-list-col-widths:v1";

function SimulationStatusCell({
  status,
  dirty,
}: {
  status: Simulation["status"];
  dirty?: boolean;
}) {
  const t = useUiTranslate();
  const config = {
    finalized: { label: t("simulator.status.finalized"), variant: "success" as const, Icon: SealCheck },
    archived: { label: t("simulator.status.archived"), variant: "draft" as const, Icon: Archive },
    draft: { label: t("simulator.status.draft"), variant: "warning" as const, Icon: Clock },
  };
  const { label, variant, Icon } = config[status] ?? config.draft;

  return (
    <span className="inline-flex items-center gap-1.5">
      <StatusBadge variant={variant} className="gap-1">
        <Icon size={11} weight="bold" />
        {label}
      </StatusBadge>
      {dirty && status === "draft" && (
        <span className="inline-flex h-2 w-2 rounded-full bg-warm" title={t("simulator.status.dirty")} />
      )}
    </span>
  );
}

export default function SimulatorPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const confirm = useConfirm();
  const t = useUiTranslate();

  // Deep-link `?is_dirty=true` is applied once at mount via the lazy initializer
  // (no effect → avoids the set-state-in-effect cascade).
  const [filters, setFilters] = useState<SimulationFilters>(() =>
    searchParams.get("is_dirty") === "true" ? { is_dirty: true } : {},
  );
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<DataTableSortState>(DEFAULT_SORT);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const tableScrollRef = useRef<HTMLDivElement>(null);

  const [filtersCollapsed, setFiltersCollapsed] = usePersistedBoolean(
    "syskern:simulation-filters-collapsed",
    false,
  );
  const {
    width: filterSidebarWidth,
    startResize: startFilterResize,
    isResizing: isFilterResizing,
  } = useResizableWidth(300, {
    min: 240,
    max: 420,
    storageKey: "syskern:simulation-filters-width",
  });

  const [savedFilters, setSavedFilters] = useState<SavedSimulationFilter[]>(
    loadSavedSimulationFilters,
  );
  useEffect(() => {
    persistSavedSimulationFilters(savedFilters);
  }, [savedFilters]);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  const { data, isLoading, error } = useSWR<PaginatedSimulations>(
    ["simulations-list", filtersKey, ordering, page],
    () =>
      getSimulationsList({
        ...filters,
        ordering,
        page,
        limit: PAGE_SIZE,
      }),
    { keepPreviousData: true },
  );

  const simulations = data?.results ?? [];
  const total = data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const columns = useMemo<DataTableColumnDef<Simulation>[]>(
    () => [
      {
        key: "label",
        label: t("simulator.column.name"),
        sortField: "label",
        width: 240,
        render: (sim) => (
          <div>
            <span className="text-sm font-semibold text-foreground">{sim.label}</span>
            {sim.project_name && (
              <span className="mt-0.5 block text-xs text-muted-foreground">{sim.project_name}</span>
            )}
          </div>
        ),
      },
      {
        key: "type",
        label: t("simulator.column.type"),
        sortField: "simulation_type",
        width: 100,
        render: (sim) => (
          <span className="text-sm text-muted-foreground">
            {sim.simulation_type === "tariff" ? t("simulator.type.tariff") : t("simulator.type.project")}
          </span>
        ),
      },
      {
        key: "lines",
        label: t("simulator.column.lines"),
        sortField: "line_count",
        width: 80,
        align: "right",
        render: (sim) => (
          <span className="font-data text-sm text-muted-foreground">{sim.line_count}</span>
        ),
      },
      {
        key: "status",
        label: t("simulator.column.status"),
        sortField: "status",
        width: 150,
        render: (sim) => <SimulationStatusCell status={sim.status} dirty={sim.is_dirty} />,
      },
      {
        key: "last_calc",
        label: t("simulator.column.lastCalc"),
        sortField: "last_calculated_at",
        width: 160,
        render: (sim) => (
          <span className="text-sm text-muted-foreground">
            {sim.last_calculated_at
              ? new Date(sim.last_calculated_at).toLocaleDateString("fr-FR", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "—"}
          </span>
        ),
      },
      {
        key: "updated",
        label: t("simulator.column.updated"),
        sortField: "updated_at",
        width: 120,
        render: (sim) => (
          <span className="text-sm text-muted-foreground">
            {new Date(sim.updated_at).toLocaleDateString("fr-FR")}
          </span>
        ),
      },
    ],
    [t],
  );

  const handleSort = useCallback((field: string) => {
    setPage(1);
    setSort((current) => cycleSortField(field, current, DEFAULT_SORT));
  }, []);

  const applyFilters = useCallback(
    (next: SimulationFilters | ((prev: SimulationFilters) => SimulationFilters)) => {
      setFilters(next);
      setPage(1);
    },
    [],
  );

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

  const pageIds = simulations.map((s) => s.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const toggleSelectPage = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });

  const selectedIds = useMemo(() => [...selected], [selected]);
  const canCompare = selected.size >= 2 && selected.size <= MAX_COMPARE;

  const compareSelection = () => {
    if (!canCompare) return;
    router.push(`/comparator/new?sims=${selectedIds.slice(0, MAX_COMPARE).join(",")}`);
  };

  const onSaveFilter = (name: string) => {
    const id = typeof crypto !== "undefined" ? crypto.randomUUID() : String(Date.now());
    setSavedFilters((prev) => [...prev, { id, name, filters }]);
  };
  const onApplyFilter = (sf: SavedSimulationFilter) => {
    const next = normalizeSimulationFilters(sf.filters);
    setFilters(next);
    setSearchInput(next.q ?? "");
    setPage(1);
  };
  const onDeleteFilter = useCallback(
    async (id: string) => {
      const sf = savedFilters.find((f) => f.id === id);
      if (!sf) return;
      const ok = await confirm({
        title: t("simulator.list.deleteFilterTitle"),
        description: t("simulator.list.deleteFilterDescription", { name: sf.name }),
        confirmLabel: t("common.delete"),
        destructive: true,
      });
      if (!ok) return;
      setSavedFilters((prev) => prev.filter((f) => f.id !== id));
    },
    [confirm, savedFilters, t],
  );

  const handlePageChange = useCallback((nextPage: number) => {
    setPage(nextPage);
    tableScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const activeFilterCount = countActiveSimulationFilters(filters);

  return (
    <div className="flex h-full bg-background">
      {filtersCollapsed ? (
        <div className="relative hidden w-12 shrink-0 flex-col items-center border-r border-border bg-card py-3 shadow-[var(--shadow-soft)] lg:flex">
          <button
            type="button"
            onClick={() => setFiltersCollapsed(false)}
            className="relative rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={t("simulator.filters.show")}
            title={t("simulator.filters.title")}
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
              <span className="text-sm font-bold text-foreground">{t("simulator.filters.title")}</span>
              {activeFilterCount > 0 && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {activeFilterCount > 1
                    ? t("simulator.filters.activeOther", { count: activeFilterCount })
                    : t("simulator.filters.activeOne", { count: activeFilterCount })}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {activeFilterCount > 0 && (
                <Button type="button" variant="ghost" size="sm" onClick={resetFilters}>
                  {t("simulator.filters.clearAll")}
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setFiltersCollapsed(true)}
                aria-label={t("simulator.filters.hide")}
                title={t("simulator.filters.hide")}
              >
                <SidebarSimple size={18} />
              </Button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto overscroll-contain">
            <SimulationFiltersSidebar
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
            aria-label={t("simulator.filters.resize")}
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
            <SimulationFilterTrigger
              activeCount={activeFilterCount}
              onClick={() => setMobileFiltersOpen(true)}
            />
            <div className="min-w-0">
              <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight text-foreground sm:text-xl">
                <Calculator size={22} weight="duotone" className="shrink-0 text-primary" />
                {t("simulator.list.title")}
              </h1>
              {!isLoading && (
                <p className="mt-0.5 text-sm tabular-nums text-muted-foreground">
                  {total !== 1
                    ? t("simulator.list.countOther", { count: total.toLocaleString("fr-FR") })
                    : t("simulator.list.countOne", { count: total.toLocaleString("fr-FR") })}
                </p>
              )}
            </div>
            <SearchInput
              className="ml-2 hidden w-72 lg:block lg:w-80"
              value={searchInput}
              onChange={onSearchChange}
              placeholder={t("simulator.list.search")}
            />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" onClick={() => router.push("/comparator")}>
              <GitDiff size={16} />
              <span className="hidden sm:inline">{t("simulator.list.comparisons")}</span>
            </Button>
            <Button onClick={() => router.push("/simulator/new")}>
              <Plus size={16} />
              <span className="hidden sm:inline">{t("simulator.list.new")}</span>
            </Button>
          </div>
        </div>

        <SimulationFilterSheet
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

        <SimulationActiveFilterBar
          filters={filters}
          onChange={applyFilters}
          onClearAll={resetFilters}
        />

        <div className="border-b border-border bg-card px-4 py-3 md:hidden">
          <SearchInput value={searchInput} onChange={onSearchChange} placeholder={t("simulator.list.searchShort")} />
        </div>

        {selected.size > 0 && (
          <div className="flex shrink-0 items-center justify-between border-b border-primary/20 bg-primary/5 px-4 py-2.5 sm:px-6">
            <span className="text-sm font-semibold text-foreground">
              {selected.size > 1
                ? t("simulator.list.selectedOther", { count: selected.size })
                : t("simulator.list.selectedOne", { count: selected.size })}
            </span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                disabled={!canCompare}
                title={
                  selected.size > MAX_COMPARE
                    ? t("simulator.list.compareMax", { max: MAX_COMPARE })
                    : selected.size < 2
                      ? t("simulator.list.compareMin")
                      : undefined
                }
                onClick={compareSelection}
              >
                <GitDiff size={15} />
                {t("simulator.list.compareSelection")}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setSelected(new Set())}
                title={t("simulator.list.clearSelection")}
                aria-label={t("simulator.list.clearSelection")}
              >
                <X size={16} weight="bold" />
              </Button>
            </div>
          </div>
        )}

        <DataTable
          scrollRef={tableScrollRef}
          columns={columns}
          rows={simulations}
          rowKey={(sim) => sim.id}
          storageKey={COLUMN_WIDTHS_KEY}
          sort={sort}
          defaultSort={DEFAULT_SORT}
          onSort={handleSort}
          isLoading={isLoading}
          onRowClick={(sim) => router.push(`/simulator/${sim.id}`)}
          rowClassName={(sim) =>
            selected.has(sim.id) ? "bg-primary/5" : "bg-card even:bg-muted/20 hover:bg-primary/5"
          }
          renderLeadingHeader={() => (
            <Checkbox
              checked={allPageSelected}
              onCheckedChange={() => toggleSelectPage()}
              aria-label={t("simulator.list.selectPage")}
            />
          )}
          renderLeadingCell={(sim) => (
            <Checkbox
              checked={selected.has(sim.id)}
              onCheckedChange={() => toggleRow(sim.id)}
              aria-label={t("simulator.list.selectRow", { name: sim.label })}
              onClick={(e) => e.stopPropagation()}
            />
          )}
          errorState={
            error ? (
              <EmptyState
                className="mx-4 my-8 border-none bg-transparent shadow-none"
                icon={<Calculator size={32} weight="duotone" />}
                title={t("simulator.list.loadError")}
                description={error.message}
              />
            ) : undefined
          }
          emptyState={
            <EmptyState
              className="mx-auto max-w-sm border-none bg-transparent shadow-none"
              icon={<Calculator size={32} weight="duotone" />}
              title={t("simulator.list.emptyTitle")}
              description={
                activeFilterCount > 0
                  ? t("simulator.list.emptyFiltered")
                  : t("simulator.list.emptyDefault")
              }
              action={
                activeFilterCount > 0 ? (
                  <Button variant="outline" size="sm" onClick={resetFilters}>
                    <Sparkle size={14} weight="duotone" />
                    {t("simulator.list.resetFilters")}
                  </Button>
                ) : (
                  <Button onClick={() => router.push("/simulator/new")}>
                    <Plus size={16} />
                    {t("simulator.list.new")}
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
            itemLabel: t("simulator.list.itemLabel"),
            jumpInputId: "simulations-page-jump",
            ariaLabel: t("simulator.list.pagination"),
          }}
        />
      </div>
    </div>
  );
}
