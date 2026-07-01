"use client";

import { useCallback, useMemo, useState } from "react";

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
} from "@phosphor-icons/react";
import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/KpiCard";
import { EmptyState } from "@/components/EmptyState";
import { FilterSelect } from "@/components/FilterSelect";
import { StatusBadge, offerStatusVariant } from "@/components/StatusBadge";
import { DataTable } from "@/components/data-table";
import type { DataTableColumnDef, DataTableSortState } from "@/components/data-table/types";
import { cycleSortField } from "@/components/data-table/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
interface SimLite {
  id: string;
  label: string;
  simulation_type: "tariff" | "project";
  status: string;
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

function sortOffers(rows: OfferRow[], sort: DataTableSortState): OfferRow[] {
  const out = [...rows];
  out.sort((a, b) => {
    let av: string | number = "";
    let bv: string | number = "";
    switch (sort.field) {
      case "label":
        av = a.label;
        bv = b.label;
        break;
      case "valid_to":
        av = a.valid_to ? new Date(a.valid_to).getTime() : 0;
        bv = b.valid_to ? new Date(b.valid_to).getTime() : 0;
        break;
      case "created_at":
        av = new Date(a.created_at).getTime();
        bv = new Date(b.created_at).getTime();
        break;
      default:
        return 0;
    }
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return sort.dir === "asc" ? cmp : -cmp;
  });
  return out;
}

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

// ── New-offer modal: pick a finalized simulation ──────────────────────────────

function NewOfferModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { data, isLoading } = useSWR(open ? "finalized-sims" : null, () =>
    getJson<Paginated<SimLite> | SimLite[]>("/api/simulations/?status=finalized&limit=1000"),
  );
  const sims = Array.isArray(data) ? data : (data?.results ?? []);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[80vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nouvelle offre</DialogTitle>
          <DialogDescription>
            Choisissez une simulation finalisée. Son type (tarif / projet) détermine le format.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <CircleNotch size={16} className="animate-spin" />
            Chargement…
          </div>
        ) : sims.length === 0 ? (
          <EmptyState
            className="border-none bg-transparent py-8 shadow-none"
            icon={<FileText size={28} weight="duotone" />}
            title="Aucune simulation finalisée"
            description="Finalisez une simulation avant de générer une offre."
          />
        ) : (
          <div className="flex flex-col gap-2">
            {sims.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  onClose();
                  router.push(
                    `/offers/new-${s.simulation_type === "project" ? "project" : "tariff"}?simulation_id=${s.id}`,
                  );
                }}
                className="flex items-center justify-between rounded-lg border border-border px-4 py-3 text-left text-sm transition-colors hover:bg-muted/50"
              >
                <span className="font-medium text-foreground">{s.label}</span>
                <StatusBadge variant={s.simulation_type === "project" ? "info" : "running"}>
                  {s.simulation_type === "project" ? "Projet" : "Tarif"}
                </StatusBadge>
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Document cell / row action ────────────────────────────────────────────────

function GenerationCell({ offer, onRetry }: { offer: OfferRow; onRetry: () => void }) {
  if (offer.offer_type === "tariff") {
    return (
      <a
        href={`/api/offers/${offer.id}/download/`}
        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-warm hover:bg-warm/10"
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
        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-warm hover:bg-warm/10"
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
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [sort, setSort] = useState<DataTableSortState>(DEFAULT_SORT);

  const query = useMemo(() => {
    const p = new URLSearchParams({ ordering: "-created_at", limit: "100" });
    if (typeFilter) p.set("offer_type", typeFilter);
    if (statusFilter) p.set("status", statusFilter);
    return p.toString();
  }, [typeFilter, statusFilter]);

  const { data, isLoading, error } = useSWR<Paginated<OfferRow>>(
    `offers:${query}`,
    () => getJson(`/api/offers/?${query}`),
    {
      // Poll only while a generation is actually running. `pending` is transient
      // (tariff offers finish READY; project offers move to generating in-task),
      // so polling on it would refresh the list forever (B1 fix).
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

  const sortedOffers = useMemo(() => sortOffers(data?.results ?? [], sort), [data?.results, sort]);

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
    <div className="p-6">
      <PageHeader
        title="Offres"
        description="Gestion des offres commerciales"
        actions={
          <Button onClick={() => setShowNew(true)}>
            <Plus size={16} weight="bold" />
            Nouvelle offre
          </Button>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {dashLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-[88px] rounded-xl" />
          ))
        ) : dash ? (
          <>
            <KpiCard label="Brouillons" value={dash.status_counts.draft ?? 0} />
            <KpiCard label="Envoyées" value={dash.status_counts.sent ?? 0} accent="blue" />
            <KpiCard label="Tarifs actifs" value={dash.tariff_active} accent="warm" />
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
              accent="warm"
              value={
                dash.won_total != null
                  ? Number(dash.won_total).toLocaleString("fr-FR", { maximumFractionDigits: 0 })
                  : "—"
              }
            />
          </>
        ) : null}
      </div>

      <div className="mb-4 flex flex-wrap gap-3">
        <FilterSelect
          value={typeFilter}
          onChange={setTypeFilter}
          placeholder="Tous les types"
          options={[
            { value: "tariff", label: "Tarif" },
            { value: "project", label: "Projet" },
          ]}
          className="w-44"
        />
        <FilterSelect
          value={statusFilter}
          onChange={setStatusFilter}
          placeholder="Tous les statuts"
          options={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))}
          className="w-44"
        />
      </div>

      <Card className="overflow-hidden py-0">
        <DataTable
          columns={columns}
          rows={sortedOffers}
          rowKey={(o) => o.id}
          storageKey="offers-list"
          sort={sort}
          defaultSort={DEFAULT_SORT}
          onSort={(field) => setSort((s) => cycleSortField(field, s, DEFAULT_SORT))}
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
              description="Cliquez « Nouvelle offre » pour en générer une."
              action={
                <Button onClick={() => setShowNew(true)}>
                  <Plus size={16} weight="bold" />
                  Nouvelle offre
                </Button>
              }
            />
          }
        />
      </Card>

      <NewOfferModal open={showNew} onClose={() => setShowNew(false)} />
    </div>
  );
}
