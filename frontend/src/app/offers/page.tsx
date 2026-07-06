"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useRouter } from "next/navigation";
import useSWR, { mutate } from "swr";
import {
  CircleNotch,
  DownloadSimple,
  FilePlus,
  FileText,
  ArrowSquareOut,
  Plus,
  ArrowsClockwise,
  Faders,
  SidebarSimple,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/ConfirmProvider";
import { usePersistedBoolean } from "@/hooks/usePersistedBoolean";
import { useResizableWidth } from "@/hooks/useResizableWidth";
import { KpiCard } from "@/components/KpiCard";
import { EmptyState } from "@/components/EmptyState";
import { SearchInput } from "@/components/SearchInput";
import { StatusBadge, offerStatusVariant } from "@/components/StatusBadge";
import { DataTable } from "@/components/data-table";
import type { DataTableColumnDef, DataTableSortState } from "@/components/data-table/types";
import { cycleSortField } from "@/components/data-table/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SimulationPickerModal } from "./_components/SimulationPickerModal";
import { OffersFiltersSidebar } from "./_components/OffersFiltersSidebar";
import { OffersActiveFilterBar } from "./_components/OffersActiveFilterBar";
import { OffersFilterSheet, OffersFilterTrigger } from "./_components/OffersFilterSheet";
import {
  buildOfferQuery,
  countActiveOfferFilters,
  normalizeOfferFilters,
  type OfferFilters,
} from "./_components/offer-filters";
import {
  loadSavedOfferFilters,
  persistSavedOfferFilters,
  type SavedOfferFilter,
} from "./_components/filters-storage";

// ── Types ────────────────────────────────────────────────────────────────────

interface OfferRow {
  id: string;
  label: string;
  offer_type: "tariff" | "project";
  status: string;
  currency: string;
  language: string;
  valid_to: string | null;
  project_name: string;
  client_ids: string[];
  line_count: number;
  generation_status: string;
  generated_file_url: string;
  generation_error: string;
  created_at: string;
}
interface Paginated<T> {
  count: number;
  results: T[];
}
interface ClientLite {
  id: string;
  name: string;
}
interface Dashboard {
  status_counts: Record<string, number>;
  project_conversion_pct: number | null;
  tariff_active: number;
  won_total: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon",
  sent: "Envoyée",
  won: "Gagnée",
  lost: "Perdue",
  expired: "Expirée",
};

const DEFAULT_SORT: DataTableSortState = { field: "created_at", dir: "desc" };
const COLUMN_WIDTHS_KEY = "offers-list";
const PAGE_SIZE = 50;

function getCsrfToken(): string {
  if (typeof document === "undefined") return "";
  const m = document.cookie.match(/csrftoken=([^;]+)/);
  return m ? m[1] : "";
}
async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error("Erreur de chargement");
  return res.json();
}
async function postJson(url: string) {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "X-CSRFToken": getCsrfToken() },
  });
  if (!res.ok) throw new Error("Erreur serveur");
  return res.json();
}

// ── Document cell / row action ────────────────────────────────────────────────

function GenerationCell({ offer, onRetry }: { offer: OfferRow; onRetry: () => void }) {
  if (offer.offer_type === "tariff") {
    return (
      <a
        href={`/api/offers/${offer.id}/download/`}
        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-brand-green hover:bg-brand-green/10"
        onClick={(e) => e.stopPropagation()}
      >
        <DownloadSimple size={14} weight="duotone" />
        Excel
      </a>
    );
  }
  if (offer.generation_status === "generating" || offer.generation_status === "pending") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <CircleNotch size={14} className="animate-spin" />
        Génération…
      </span>
    );
  }
  if (offer.generation_status === "error") {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={(e) => {
          e.stopPropagation();
          onRetry();
        }}
        title={offer.generation_error}
        className="h-auto px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10"
      >
        <ArrowsClockwise size={14} />
        Réessayer
      </Button>
    );
  }
  if (offer.generation_status === "ready" && offer.generated_file_url) {
    return (
      <a
        href={offer.generated_file_url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-brand-green hover:bg-brand-green/10"
        onClick={(e) => e.stopPropagation()}
      >
        <ArrowSquareOut size={14} weight="duotone" />
        Gamma
      </a>
    );
  }
  return <span className="text-xs text-muted-foreground/50">—</span>;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function OffersPage() {
  const router = useRouter();
  const confirm = useConfirm();

  const [filters, setFilters] = useState<OfferFilters>({});
  const [searchInput, setSearchInput] = useState("");
  const [sort, setSort] = useState<DataTableSortState>(DEFAULT_SORT);
  const [page, setPage] = useState(1);
  const [showNew, setShowNew] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const [filtersCollapsed, setFiltersCollapsed] = usePersistedBoolean(
    "syskern:offer-filters-collapsed",
    false,
  );
  const {
    width: filterSidebarWidth,
    startResize: startFilterResize,
    isResizing: isFilterResizing,
  } = useResizableWidth(300, {
    min: 240,
    max: 420,
    storageKey: "syskern:offer-filters-width",
  });

  const [savedFilters, setSavedFilters] = useState<SavedOfferFilter[]>(loadSavedOfferFilters);
  useEffect(() => {
    persistSavedOfferFilters(savedFilters);
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
  const query = useMemo(
    () => buildOfferQuery(filters, { ordering, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    [filters, ordering, page],
  );

  const { data, isLoading, error } = useSWR<Paginated<OfferRow>>(
    `offers:${query}`,
    () => getJson(`/api/offers/?${query}`),
    {
      // Poll only while a generation is actually running (B1 fix).
      refreshInterval: (d) =>
        d?.results?.some((o) => o.generation_status === "generating") ? 5000 : 0,
    },
  );
  const { data: dash, isLoading: dashLoading } = useSWR<Dashboard>("offers-dashboard", () =>
    getJson<Dashboard>("/api/offers/dashboard"),
  );
  const { data: clientsResp } = useSWR("clients:all", () =>
    getJson<Paginated<ClientLite> | ClientLite[]>("/api/clients/?limit=1000"),
  );
  const clientName = useMemo(() => {
    const list = Array.isArray(clientsResp) ? clientsResp : (clientsResp?.results ?? []);
    const map = new Map(list.map((c) => [c.id, c.name]));
    return (ids: string[]) => ids.map((i) => map.get(i) ?? "—").join(", ") || "—";
  }, [clientsResp]);

  const retry = useCallback(
    async (id: string) => {
      try {
        await postJson(`/api/offers/${id}/regenerate/`);
      } finally {
        mutate(`offers:${query}`);
      }
    },
    [query],
  );

  const offers = data?.results ?? [];
  const total = data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const activeFilterCount = countActiveOfferFilters(filters);

  const applyFilters = useCallback((next: OfferFilters) => {
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
  const onApplyFilter = (sf: SavedOfferFilter) => {
    const next = normalizeOfferFilters(sf.filters);
    setFilters(next);
    setSearchInput(next.q ?? "");
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

  const columns = useMemo<DataTableColumnDef<OfferRow>[]>(
    () => [
      {
        key: "label",
        label: "Offre",
        width: 240,
        sortField: "label",
        render: (o) => (
          <div>
            <span className="text-sm font-medium text-foreground">{o.label}</span>
            <div className="text-xs text-muted-foreground">
              <span className="font-data">{o.line_count}</span> ligne(s) · {o.currency}
            </div>
          </div>
        ),
      },
      {
        key: "offer_type",
        label: "Type",
        width: 100,
        render: (o) => (
          <StatusBadge variant={o.offer_type === "project" ? "info" : "running"}>
            {o.offer_type === "project" ? "Projet" : "Tarif"}
          </StatusBadge>
        ),
      },
      {
        key: "clients",
        label: "Client(s)",
        width: 180,
        cellClassName: "text-sm text-muted-foreground truncate",
        render: (o) => clientName(o.client_ids),
      },
      {
        key: "status",
        label: "Statut",
        width: 110,
        render: (o) => (
          <StatusBadge variant={offerStatusVariant(o.status)}>
            {STATUS_LABELS[o.status] ?? o.status}
          </StatusBadge>
        ),
      },
      {
        key: "valid_to",
        label: "Validité",
        width: 120,
        sortField: "valid_to",
        cellClassName: "text-sm text-muted-foreground font-data",
        render: (o) => (o.valid_to ? new Date(o.valid_to).toLocaleDateString("fr-FR") : "—"),
      },
      {
        key: "document",
        label: "Document",
        width: 130,
        render: (o) => <GenerationCell offer={o} onRetry={() => retry(o.id)} />,
      },
    ],
    [clientName, retry],
  );

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
            <OffersFiltersSidebar
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
            <OffersFilterTrigger
              activeCount={activeFilterCount}
              onClick={() => setMobileFiltersOpen(true)}
            />
            <div className="min-w-0">
              <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight text-foreground sm:text-xl">
                <FileText size={22} weight="duotone" className="shrink-0 text-primary" />
                Offres
              </h1>
              {!isLoading && (
                <p className="mt-0.5 text-sm tabular-nums text-muted-foreground">
                  {total.toLocaleString("fr-FR")} offre{total !== 1 ? "s" : ""}
                </p>
              )}
            </div>
            <SearchInput
              className="ml-2 hidden w-72 lg:block lg:w-80"
              value={searchInput}
              onChange={onSearchChange}
              placeholder="Recherche offre, projet…"
            />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button onClick={() => setShowNew(true)}>
              <Plus size={16} weight="bold" />
              <span className="hidden sm:inline">Nouvelle offre</span>
            </Button>
          </div>
        </div>

        <OffersFilterSheet
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

        <OffersActiveFilterBar
          filters={filters}
          onChange={applyFilters}
          onClearAll={resetFilters}
        />

        <div className="border-b border-border bg-card px-4 py-3 md:hidden">
          <SearchInput value={searchInput} onChange={onSearchChange} placeholder="Rechercher…" />
        </div>

        <div className="shrink-0 border-b border-border bg-card px-4 py-4 sm:px-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {dashLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-[88px] rounded-xl" />
              ))
            ) : dash ? (
              <>
                <KpiCard label="Brouillons" value={dash.status_counts.draft ?? 0} />
                <KpiCard label="Envoyées" value={dash.status_counts.sent ?? 0} accent="blue" />
                <KpiCard label="Tarifs actifs" value={dash.tariff_active} accent="green" />
                <KpiCard
                  label="Conversion projets"
                  accent="green"
                  value={
                    dash.project_conversion_pct != null
                      ? `${dash.project_conversion_pct.toFixed(0)}%`
                      : "—"
                  }
                />
                <KpiCard
                  label="CA gagné (€)"
                  accent="green"
                  value={
                    dash.won_total != null
                      ? Number(dash.won_total).toLocaleString("fr-FR", {
                          maximumFractionDigits: 0,
                        })
                      : "—"
                  }
                />
              </>
            ) : null}
          </div>
        </div>

        <DataTable
          columns={columns}
          rows={offers}
          rowKey={(o) => o.id}
          storageKey={COLUMN_WIDTHS_KEY}
          sort={sort}
          defaultSort={DEFAULT_SORT}
          onSort={(field) => {
            setPage(1);
            setSort((s) => cycleSortField(field, s, DEFAULT_SORT));
          }}
          isLoading={isLoading}
          onRowClick={(o) => router.push(`/offers/${o.id}`)}
          errorState={
            error ? (
              <EmptyState
                className="border-none bg-transparent py-16 shadow-none"
                icon={<FileText size={28} weight="duotone" />}
                title="Impossible de charger les offres"
              />
            ) : undefined
          }
          emptyState={
            <EmptyState
              className="border-none bg-transparent py-16 shadow-none"
              icon={<FilePlus size={28} weight="duotone" />}
              title="Aucune offre"
              description={
                activeFilterCount > 0
                  ? "Essayez d'élargir vos filtres ou de modifier la recherche."
                  : "Cliquez « Nouvelle offre » pour en générer une."
              }
              action={
                activeFilterCount > 0 ? (
                  <Button variant="outline" size="sm" onClick={resetFilters}>
                    Réinitialiser les filtres
                  </Button>
                ) : (
                  <Button onClick={() => setShowNew(true)}>
                    <Plus size={16} weight="bold" />
                    Nouvelle offre
                  </Button>
                )
              }
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
                  itemLabel: "offre",
                  jumpInputId: "offers-page-jump",
                  ariaLabel: "Pagination des offres",
                }
              : undefined
          }
        />
      </div>

      <SimulationPickerModal open={showNew} onClose={() => setShowNew(false)} />
    </div>
  );
}
