"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import useSWR, { mutate } from "swr";
import {
  CheckCircle,
  CircleNotch,
  Faders,
  FileX,
  ShieldWarning,
  SidebarSimple,
  Warning,
  WarningCircle,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { useRequireAdmin } from "@/hooks/useRequireAdmin";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirm } from "@/components/ConfirmProvider";
import { usePersistedBoolean } from "@/hooks/usePersistedBoolean";
import { useResizableWidth } from "@/hooks/useResizableWidth";
import { DataTable } from "@/components/data-table";
import type { DataTableColumnDef, DataTableSortState } from "@/components/data-table/types";
import { cycleSortField } from "@/components/data-table/types";
import { AppModal } from "@/components/AppModal";
import { FormField } from "@/components/FormField";
import { AppIcon } from "@/components/AppIcon";
import { EmptyState } from "@/components/EmptyState";
import { KpiCard } from "@/components/KpiCard";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { QuarantineFiltersSidebar } from "./_components/QuarantineFiltersSidebar";
import { QuarantineActiveFilterBar } from "./_components/QuarantineActiveFilterBar";
import {
  QuarantineFilterSheet,
  QuarantineFilterTrigger,
} from "./_components/QuarantineFilterSheet";
import {
  buildQuarantineQuery,
  countActiveQuarantineFilters,
  normalizeQuarantineFilters,
  REASON_LABELS,
  type QuarantineFilters,
} from "./_components/quarantine-filters";
import {
  loadSavedQuarantineFilters,
  persistSavedQuarantineFilters,
  type SavedQuarantineFilter,
} from "./_components/filters-storage";

const PAGE_SIZE = 25;
const DEFAULT_SORT: DataTableSortState = { field: "created_at", dir: "desc" };

type ResolutionAction = "ignore" | "create" | "delete";

const ACTION_LABELS: Record<ResolutionAction, string> = {
  ignore: "Ne rien faire",
  create: "Créer le produit",
  delete: "Supprimer",
};

interface UnmatchedRow {
  id: string;
  source_file: string;
  source_row_number: number | null;
  raw_data: Record<string, unknown>;
  reason: string;
  resolved_at: string | null;
  resolved_by: string;
  resolution_notes: string;
  resolution_action: string;
  created_at: string;
}

// Prefill the create form from the raw row. The SKU must come from the SKU
// column (`sku_code`, `item_code`, …), NEVER from the GTIN/EAN column — the row
// carries both and the GTIN is a plain number that would otherwise be mistaken
// for a code.
const SKU_KEY_RE =
  /^(sku_?code|sku|internal_?code|default_?code|code_?interne|reference|référence|item_?code)$/i;
const GTIN_KEY_RE = /gtin|ean|barcode|code.?barre|upc/i;
const NAME_KEY_RE =
  /^(description_fr|description_en|description|name|désignation|designation|libell.*|label|catalogue)$/i;
const META_KEY_RE = /^__.*__$/;

function guessProduct(raw: Record<string, unknown>): { sku: string; name: string } {
  const str = (v: unknown) => (v == null ? "" : String(v)).trim();
  const entries = Object.entries(raw).filter(([k]) => !META_KEY_RE.test(k));

  // 1. SKU from an explicit SKU column (never a GTIN/EAN column).
  let sku = "";
  for (const [k, v] of entries) {
    if (SKU_KEY_RE.test(k) && !GTIN_KEY_RE.test(k)) {
      const s = str(v);
      if (s) {
        sku = s;
        break;
      }
    }
  }
  // 2. Fallback: a value that looks like a code AND contains a letter (so a
  //    numeric GTIN or price is never picked), skipping GTIN columns.
  if (!sku) {
    for (const [k, v] of entries) {
      if (GTIN_KEY_RE.test(k)) continue;
      const s = str(v);
      if (/^[A-Za-z0-9][A-Za-z0-9-]{3,}$/.test(s) && /[A-Za-z]/.test(s)) {
        sku = s;
        break;
      }
    }
  }

  // Name: prefer a description/name column; else the longest non-numeric,
  // non-SKU value.
  let name = "";
  for (const [k, v] of entries) {
    if (NAME_KEY_RE.test(k)) {
      const s = str(v);
      if (s && s !== sku) {
        name = s;
        break;
      }
    }
  }
  if (!name) {
    name =
      entries
        .map(([, v]) => str(v))
        .filter((v) => v && v !== sku && !/^\d[\d.,\s]*$/.test(v))
        .sort((a, b) => b.length - a.length)[0] ?? "";
  }
  return { sku, name };
}

interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

interface Facets {
  total: number;
  resolved: number;
  unresolved: number;
  by_reason: Record<string, number>;
  source_files: string[];
}

function getCsrfToken(): string {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(/csrftoken=([^;]+)/);
  return match ? match[1] : "";
}

async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error("Erreur de chargement");
  return res.json();
}

interface ResolvePayload {
  action: ResolutionAction;
  resolved_by?: string;
  resolution_notes?: string;
  product?: { sku_code: string; name?: string };
}

async function resolveRow(id: string, payload: ResolvePayload) {
  const res = await fetch(`/api/migration/unmatched/${id}/resolve/`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrfToken() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(
      data?.product?.[0] ??
        data?.product?.sku_code?.[0] ??
        data?.resolved_by?.[0] ??
        data?.detail ??
        "Erreur serveur",
    );
  }
  return res.json();
}

function DetailModal({
  row,
  defaultEmail,
  open,
  onClose,
}: {
  row: UnmatchedRow;
  defaultEmail: string;
  open: boolean;
  onClose: () => void;
}) {
  const guess = useMemo(() => guessProduct(row.raw_data), [row.raw_data]);
  const [action, setAction] = useState<ResolutionAction>("ignore");
  const [sku, setSku] = useState(guess.sku);
  const [name, setName] = useState(guess.name);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isResolved = !!row.resolved_at;

  const handleResolve = async () => {
    setError(null);
    setLoading(true);
    try {
      const payload: ResolvePayload = {
        action,
        resolved_by: defaultEmail || undefined,
        resolution_notes: notes || undefined,
      };
      if (action === "create") {
        payload.product = { sku_code: sku.trim().toUpperCase(), name: name.trim() || undefined };
      }
      await resolveRow(row.id, payload);
      await Promise.all([
        mutate((k) => typeof k === "string" && k.startsWith("quarantine:")),
        mutate("quarantine-facets"),
      ]);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setLoading(false);
    }
  };

  const primaryLabel =
    action === "create"
      ? "Créer et résoudre"
      : action === "delete"
        ? "Supprimer la ligne"
        : "Ignorer la ligne";
  const primaryDisabled = loading || (action === "create" && !sku.trim());

  return (
    <AppModal
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={
        row.source_row_number != null
          ? `${row.source_file} · ligne ${row.source_row_number}`
          : row.source_file
      }
      size="2xl"
      footer={
        isResolved ? (
          <Button type="button" onClick={onClose}>
            Fermer
          </Button>
        ) : (
          <>
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Annuler
            </Button>
            <Button
              type="button"
              onClick={handleResolve}
              disabled={primaryDisabled}
              variant={action === "delete" ? "destructive" : "default"}
              className="gap-2"
            >
              {loading && <AppIcon icon={CircleNotch} size="sm" className="animate-spin" />}
              {loading ? "Enregistrement…" : primaryLabel}
            </Button>
          </>
        )
      }
    >
      <div className="mb-4">
        <StatusBadge variant="warning">{REASON_LABELS[row.reason] ?? row.reason}</StatusBadge>
      </div>

      <FormField label="Données de la ligne">
        <dl className="grid max-h-[min(38vh,300px)] grid-cols-[minmax(0,180px)_1fr] gap-x-3 gap-y-1.5 overflow-auto rounded-lg border border-border bg-muted/30 p-3 text-sm">
          {Object.entries(row.raw_data).map(([k, v]) => (
            <Fragment key={k}>
              <dt className="truncate font-medium text-muted-foreground" title={k}>
                {k}
              </dt>
              <dd className="break-words text-foreground">
                {v == null || v === "" ? "—" : String(v)}
              </dd>
            </Fragment>
          ))}
        </dl>
      </FormField>

      {isResolved ? (
        <div className="mt-4 rounded-lg border border-brand-green/30 bg-brand-green/10 p-4 text-sm">
          <div className="mb-1 flex items-center gap-2 font-medium text-brand-green">
            <AppIcon icon={CheckCircle} size="sm" />
            Résolue
            {row.resolution_action && (
              <span className="text-muted-foreground">
                ·{" "}
                {ACTION_LABELS[row.resolution_action as ResolutionAction] ?? row.resolution_action}
              </span>
            )}
          </div>
          <div className="text-muted-foreground">
            Par {row.resolved_by} le {new Date(row.resolved_at!).toLocaleString("fr-FR")}
          </div>
          {row.resolution_notes && (
            <div className="mt-2 whitespace-pre-wrap text-muted-foreground">
              {row.resolution_notes}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <FormField label="Action">
            <div className="flex flex-wrap gap-2">
              {(["ignore", "create", "delete"] as const).map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAction(a)}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-sm transition-colors",
                    action === a
                      ? "border-primary bg-primary/10 font-medium text-primary"
                      : "border-border text-muted-foreground hover:bg-muted",
                  )}
                >
                  {ACTION_LABELS[a]}
                </button>
              ))}
            </div>
          </FormField>

          {action === "create" && (
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Code SKU" required>
                <Input
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  className="font-mono uppercase"
                  placeholder="KCFF…-21"
                />
              </FormField>
              <FormField label="Désignation">
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </FormField>
            </div>
          )}

          {action === "delete" && (
            <p className="text-xs text-muted-foreground">
              La ligne sera marquée résolue et écartée (conservée pour l’audit, pas de suppression
              physique).
            </p>
          )}

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <FormField label="Note (optionnel)">
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Précision facultative sur l’arbitrage."
            />
          </FormField>
        </div>
      )}
    </AppModal>
  );
}

export default function MigrationQuarantinePage() {
  const { isLoading: authLoading, allowed } = useRequireAdmin();
  const { user } = useAuth();
  const confirm = useConfirm();

  const [filters, setFilters] = useState<QuarantineFilters>({});
  const [offset, setOffset] = useState(0);
  const [detailRow, setDetailRow] = useState<UnmatchedRow | null>(null);
  const [sort, setSort] = useState<DataTableSortState>(DEFAULT_SORT);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const [filtersCollapsed, setFiltersCollapsed] = usePersistedBoolean(
    "syskern:quarantine-filters-collapsed",
    false,
  );
  const {
    width: filterSidebarWidth,
    startResize: startFilterResize,
    isResizing: isFilterResizing,
  } = useResizableWidth(300, {
    min: 240,
    max: 420,
    storageKey: "syskern:quarantine-filters-width",
  });

  const [savedFilters, setSavedFilters] = useState<SavedQuarantineFilter[]>(
    loadSavedQuarantineFilters,
  );
  useEffect(() => {
    persistSavedQuarantineFilters(savedFilters);
  }, [savedFilters]);

  const ordering = `${sort.dir === "desc" ? "-" : ""}${sort.field}`;
  const query = useMemo(
    () => buildQuarantineQuery(filters, { limit: PAGE_SIZE, offset, ordering }),
    [filters, offset, ordering],
  );

  const { data, isLoading, error } = useSWR<Paginated<UnmatchedRow>>(`quarantine:${query}`, () =>
    fetcher<Paginated<UnmatchedRow>>(`/api/migration/unmatched/?${query}`),
  );
  const { data: facets } = useSWR<Facets>("quarantine-facets", () =>
    fetcher<Facets>("/api/migration/unmatched/facets/"),
  );

  const applyFilters = useCallback((next: QuarantineFilters) => {
    setFilters(next);
    setOffset(0);
  }, []);
  const resetFilters = () => {
    setFilters({});
    setOffset(0);
  };

  const onSaveFilter = (name: string) => {
    const id = typeof crypto !== "undefined" ? crypto.randomUUID() : String(Date.now());
    setSavedFilters((prev) => [...prev, { id, name, filters }]);
  };
  const onApplyFilter = (sf: SavedQuarantineFilter) => {
    applyFilters(normalizeQuarantineFilters(sf.filters));
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

  const columns = useMemo<DataTableColumnDef<UnmatchedRow>[]>(
    () => [
      {
        key: "source_file",
        label: "Fichier source",
        width: 220,
        sortField: "source_file",
        render: (r) => <span className="text-sm text-foreground">{r.source_file}</span>,
      },
      {
        key: "row",
        label: "Ligne",
        width: 80,
        sortField: "source_row_number",
        render: (r) => (
          <span className="text-sm text-muted-foreground">{r.source_row_number ?? "—"}</span>
        ),
      },
      {
        key: "reason",
        label: "Raison",
        width: 200,
        sortField: "reason",
        render: (r) => (
          <StatusBadge variant="warning">{REASON_LABELS[r.reason] ?? r.reason}</StatusBadge>
        ),
      },
      {
        key: "status",
        label: "Statut",
        width: 140,
        sortField: "resolved_at",
        render: (r) =>
          r.resolved_at ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-brand-green">
              <AppIcon icon={CheckCircle} size="sm" />
              Résolue
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-warm">
              <AppIcon icon={Warning} size="sm" />À traiter
            </span>
          ),
      },
    ],
    [],
  );

  if (authLoading || !allowed) {
    return (
      <div className="p-6">
        <div className="py-12 text-center text-sm text-muted-foreground">Chargement…</div>
      </div>
    );
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.count / PAGE_SIZE)) : 1;
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const activeFilterCount = countActiveQuarantineFilters(filters);
  const sourceFiles = facets?.source_files ?? [];

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
            <QuarantineFiltersSidebar
              filters={filters}
              onChange={applyFilters}
              sourceFiles={sourceFiles}
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
            <QuarantineFilterTrigger
              activeCount={activeFilterCount}
              onClick={() => setMobileFiltersOpen(true)}
            />
            <div className="min-w-0">
              <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight text-foreground sm:text-xl">
                <ShieldWarning size={22} weight="duotone" className="shrink-0 text-primary" />
                Quarantaine de migration
              </h1>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Lignes non matchables lors de l’import initial.
              </p>
            </div>
          </div>
        </div>

        <QuarantineFilterSheet
          open={mobileFiltersOpen}
          onOpenChange={setMobileFiltersOpen}
          filters={filters}
          onChange={applyFilters}
          onReset={resetFilters}
          sourceFiles={sourceFiles}
          savedFilters={savedFilters}
          onSaveFilter={onSaveFilter}
          onApplyFilter={onApplyFilter}
          onDeleteFilter={onDeleteFilter}
        />

        <QuarantineActiveFilterBar
          filters={filters}
          onChange={applyFilters}
          onClearAll={resetFilters}
        />

        {facets && (
          <div className="shrink-0 border-b border-border bg-card px-4 py-4 sm:px-6">
            <div className="grid max-w-xl grid-cols-3 gap-3">
              <KpiCard label="Total" value={facets.total} />
              <KpiCard label="À traiter" value={facets.unresolved} accent="warm" />
              <KpiCard label="Résolues" value={facets.resolved} accent="green" />
            </div>
          </div>
        )}

        <DataTable
          columns={columns}
          rows={data?.results ?? []}
          rowKey={(r) => r.id}
          storageKey="migration-quarantine"
          sort={sort}
          defaultSort={DEFAULT_SORT}
          onSort={(field) => setSort((s) => cycleSortField(field, s, DEFAULT_SORT))}
          isLoading={isLoading}
          trailingWidth={140}
          renderTrailingCell={(r) => (
            <Button variant="ghost" size="sm" onClick={() => setDetailRow(r)}>
              {r.resolved_at ? "Voir" : "Voir / Résoudre"}
            </Button>
          )}
          pagination={
            data && data.count > PAGE_SIZE
              ? {
                  page: currentPage,
                  totalPages,
                  totalCount: data.count,
                  pageSize: PAGE_SIZE,
                  itemLabel: "ligne",
                  onPageChange: (p) => setOffset((p - 1) * PAGE_SIZE),
                }
              : undefined
          }
          errorState={
            error ? (
              <EmptyState
                icon={<AppIcon icon={WarningCircle} size="lg" />}
                title="Impossible de charger la quarantaine"
              />
            ) : undefined
          }
          emptyState={
            <EmptyState
              icon={<AppIcon icon={FileX} size="lg" />}
              title="Aucune ligne en quarantaine pour ces filtres"
              description={activeFilterCount > 0 ? "Essayez d’élargir vos filtres." : undefined}
              action={
                activeFilterCount > 0 ? (
                  <Button variant="outline" size="sm" onClick={resetFilters}>
                    Réinitialiser les filtres
                  </Button>
                ) : undefined
              }
            />
          }
        />
      </div>

      {detailRow && (
        <DetailModal
          row={detailRow}
          defaultEmail={user?.email ?? ""}
          open
          onClose={() => setDetailRow(null)}
        />
      )}
    </div>
  );
}
