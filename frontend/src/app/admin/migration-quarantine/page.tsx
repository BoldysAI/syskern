"use client";

import { Fragment, useMemo, useState } from "react";
import useSWR, { mutate } from "swr";
import { CheckCircle, CircleNotch, FileX, Warning, WarningCircle } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { useRequireAdmin } from "@/hooks/useRequireAdmin";
import { useAuth } from "@/contexts/AuthContext";
import { DataTable } from "@/components/data-table";
import type { DataTableColumnDef, DataTableSortState } from "@/components/data-table/types";
import { cycleSortField } from "@/components/data-table/types";
import { AppModal } from "@/components/AppModal";
import { FormField } from "@/components/FormField";
import { FilterSelect } from "@/components/FilterSelect";
import { AppIcon } from "@/components/AppIcon";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { KpiCard } from "@/components/KpiCard";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const PAGE_SIZE = 25;
const DEFAULT_SORT: DataTableSortState = { field: "created_at", dir: "desc" };

const REASON_LABELS: Record<string, string> = {
  no_sku: "SKU manquant",
  no_match: "Aucune correspondance",
  duplicate_match: "Correspondances multiples",
  invalid_format: "Format invalide",
  missing_required_field: "Champ requis manquant",
};

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

/** Best-effort prefill: the raw row's most SKU-looking value + longest label. */
function guessProduct(raw: Record<string, unknown>): { sku: string; name: string } {
  const values = Object.values(raw).map((v) => (v == null ? "" : String(v)).trim());
  const sku = values.find((v) => /^[A-Z0-9][A-Z0-9-]{3,}$/.test(v)) ?? "";
  const name = values.filter((v) => v && v !== sku).sort((a, b) => b.length - a.length)[0] ?? "";
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

  const [sourceFile, setSourceFile] = useState("");
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState<"" | "true" | "false">("");
  const [offset, setOffset] = useState(0);
  const [detailRow, setDetailRow] = useState<UnmatchedRow | null>(null);
  const [sort, setSort] = useState<DataTableSortState>(DEFAULT_SORT);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    p.set("limit", String(PAGE_SIZE));
    p.set("offset", String(offset));
    if (sourceFile) p.set("source_file", sourceFile);
    if (reason) p.set("reason", reason);
    if (status) p.set("resolved", status);
    if (sort.field) p.set("ordering", `${sort.dir === "desc" ? "-" : ""}${sort.field}`);
    return p.toString();
  }, [sourceFile, reason, status, offset, sort]);

  const { data, isLoading, error } = useSWR<Paginated<UnmatchedRow>>(`quarantine:${query}`, () =>
    fetcher<Paginated<UnmatchedRow>>(`/api/migration/unmatched/?${query}`),
  );
  const { data: facets } = useSWR<Facets>("quarantine-facets", () =>
    fetcher<Facets>("/api/migration/unmatched/facets/"),
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

  const resetPaging = () => setOffset(0);
  const totalPages = data ? Math.max(1, Math.ceil(data.count / PAGE_SIZE)) : 1;
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="p-6">
      <PageHeader
        title="Quarantaine de migration"
        description="Lignes non matchables lors de l'import initial (CDC §8.7). À traiter manuellement — pas de ré-injection automatique."
      />

      {facets && (
        <div className="mb-5 grid max-w-xl grid-cols-3 gap-3">
          <KpiCard label="Total" value={facets.total} />
          <KpiCard label="À traiter" value={facets.unresolved} accent="warm" />
          <KpiCard label="Résolues" value={facets.resolved} accent="green" />
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-3">
        <FilterSelect
          value={sourceFile}
          onChange={(v) => {
            setSourceFile(v);
            resetPaging();
          }}
          placeholder="Tous les fichiers"
          options={(facets?.source_files ?? []).map((f) => ({ value: f, label: f }))}
          className="min-w-[200px]"
        />
        <FilterSelect
          value={reason}
          onChange={(v) => {
            setReason(v);
            resetPaging();
          }}
          placeholder="Toutes les raisons"
          options={Object.entries(REASON_LABELS).map(([k, label]) => ({ value: k, label }))}
          className="min-w-[200px]"
        />
        <FilterSelect
          value={status}
          onChange={(v) => {
            setStatus(v as "" | "true" | "false");
            resetPaging();
          }}
          placeholder="Tous les statuts"
          options={[
            { value: "false", label: "À traiter" },
            { value: "true", label: "Résolues" },
          ]}
          className="min-w-[160px]"
        />
      </div>

      <Card className="overflow-hidden py-0">
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
            />
          }
        />
      </Card>

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
