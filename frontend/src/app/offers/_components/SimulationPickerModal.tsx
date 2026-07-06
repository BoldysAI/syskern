"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { FileText } from "@phosphor-icons/react";
import {
  getSimulationsList,
  type PaginatedSimulations,
  type Simulation,
  type SimulationFilters,
} from "@/lib/api";
import { EmptyState } from "@/components/EmptyState";
import { SearchInput } from "@/components/SearchInput";
import { StatusBadge } from "@/components/StatusBadge";
import {
  DataTable,
  cycleSortField,
  type DataTableColumnDef,
  type DataTableSortState,
} from "@/components/data-table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SimulationFiltersSidebar } from "@/app/simulator/_components/SimulationFiltersSidebar";

const PAGE_SIZE = 50;
const DEFAULT_SORT: DataTableSortState = { field: "updated_at", dir: "desc" };

interface SimulationPickerModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * "Nouvelle offre" simulation picker — mirrors the catalogue product-add flow
 * (AddProductsModal ↔ CatalogBrowser): left filter sidebar + search + paginated
 * table, scoped to finalized simulations. Picking a row opens the matching offer
 * wizard.
 */
export function SimulationPickerModal({ open, onClose }: SimulationPickerModalProps) {
  const router = useRouter();

  const [filters, setFilters] = useState<SimulationFilters>({});
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<DataTableSortState>(DEFAULT_SORT);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onSearchChange = (v: string) => {
    setSearchInput(v);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setFilters((f) => ({ ...f, q: v || undefined }));
      setPage(1);
    }, 300);
  };

  const applyFilters = (next: SimulationFilters) => {
    setFilters(next);
    setPage(1);
  };

  const ordering = `${sort.dir === "desc" ? "-" : ""}${sort.field}`;
  const filtersKey = JSON.stringify(filters);

  const { data, isLoading, error } = useSWR<PaginatedSimulations>(
    open ? ["offer-sim-picker", filtersKey, ordering, page] : null,
    () =>
      getSimulationsList({
        ...filters,
        status: ["finalized"], // offers require a finalized simulation (CDC §7.9)
        ordering,
        page,
        limit: PAGE_SIZE,
      }),
    { keepPreviousData: true },
  );

  const sims = data?.results ?? [];
  const total = data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const pick = (sim: Simulation) => {
    onClose();
    router.push(
      `/offers/new-${sim.simulation_type === "project" ? "project" : "tariff"}?simulation_id=${sim.id}`,
    );
  };

  const columns = useMemo<DataTableColumnDef<Simulation>[]>(
    () => [
      {
        key: "label",
        label: "Simulation",
        sortField: "label",
        width: 260,
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
        label: "Type",
        sortField: "simulation_type",
        width: 100,
        render: (sim) => (
          <StatusBadge variant={sim.simulation_type === "project" ? "info" : "running"}>
            {sim.simulation_type === "project" ? "Projet" : "Tarif"}
          </StatusBadge>
        ),
      },
      {
        key: "lines",
        label: "Lignes",
        sortField: "line_count",
        width: 80,
        align: "right",
        render: (sim) => (
          <span className="font-data text-sm text-muted-foreground">{sim.line_count}</span>
        ),
      },
      {
        key: "last_calc",
        label: "Dernier calcul",
        sortField: "last_calculated_at",
        width: 150,
        render: (sim) => (
          <span className="text-sm text-muted-foreground">
            {sim.last_calculated_at
              ? new Date(sim.last_calculated_at).toLocaleDateString("fr-FR")
              : "—"}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex max-h-[92vh] max-w-5xl flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>Nouvelle offre</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Choisissez une simulation finalisée. Son type (tarif / projet) détermine le format.
          </p>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-card md:flex lg:w-60">
            <div className="flex-1 overflow-y-auto overscroll-contain">
              <SimulationFiltersSidebar
                filters={filters}
                onChange={applyFilters}
                hideStatus
                hideDirty
                hideSaved
              />
            </div>
          </aside>

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="shrink-0 border-b border-border px-4 py-3">
              <SearchInput
                value={searchInput}
                onChange={onSearchChange}
                placeholder="Rechercher une simulation…"
              />
            </div>

            <DataTable
              columns={columns}
              rows={sims}
              rowKey={(sim) => sim.id}
              storageKey="offer-sim-picker-col-widths"
              sort={sort}
              defaultSort={DEFAULT_SORT}
              onSort={(field) => {
                setPage(1);
                setSort((s) => cycleSortField(field, s, DEFAULT_SORT));
              }}
              isLoading={isLoading}
              onRowClick={pick}
              errorState={
                error ? (
                  <EmptyState
                    className="border-none bg-transparent py-12 shadow-none"
                    icon={<FileText size={28} weight="duotone" />}
                    title="Impossible de charger les simulations"
                  />
                ) : undefined
              }
              emptyState={
                <EmptyState
                  className="border-none bg-transparent py-12 shadow-none"
                  icon={<FileText size={28} weight="duotone" />}
                  title="Aucune simulation finalisée"
                  description="Finalisez une simulation avant de générer une offre."
                />
              }
              pagination={
                total > PAGE_SIZE
                  ? {
                      page,
                      totalPages,
                      totalCount: total,
                      pageSize: PAGE_SIZE,
                      onPageChange: setPage,
                      itemLabel: "simulation",
                      jumpInputId: "offer-sim-picker-page",
                      ariaLabel: "Pagination des simulations",
                    }
                  : undefined
              }
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
