"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR, { mutate } from "swr";
import { Download, ExternalLink, FileText, Loader2, Plus, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/KpiCard";

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
const STATUS_COLORS: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600",
  sent: "bg-blue-100 text-blue-700",
  won: "bg-green-100 text-green-700",
  lost: "bg-red-100 text-red-700",
  expired: "bg-amber-100 text-amber-700",
};

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

function NewOfferModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { data, isLoading } = useSWR("finalized-sims", () =>
    getJson<Paginated<SimLite> | SimLite[]>("/api/simulations/?status=finalized&limit=1000"),
  );
  const sims = Array.isArray(data) ? data : (data?.results ?? []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Nouvelle offre</h2>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>
        <p className="mb-4 text-sm text-slate-500">
          Choisissez une simulation finalisée. Son type (tarif / projet) détermine le format.
        </p>
        {isLoading ? (
          <p className="py-8 text-center text-sm text-slate-400">Chargement…</p>
        ) : sims.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">
            Aucune simulation finalisée. Finalisez une simulation d&apos;abord.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {sims.map((s) => (
              <button
                key={s.id}
                onClick={() =>
                  router.push(
                    `/offers/new-${s.simulation_type === "project" ? "project" : "tariff"}?simulation_id=${s.id}`,
                  )
                }
                className="flex items-center justify-between rounded-lg border border-border px-4 py-3 text-left text-sm hover:bg-slate-50"
              >
                <span className="font-medium text-slate-700">{s.label}</span>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-semibold",
                    s.simulation_type === "project"
                      ? "bg-purple-100 text-purple-700"
                      : "bg-blue-100 text-blue-700",
                  )}
                >
                  {s.simulation_type === "project" ? "Projet" : "Tarif"}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Document cell / row action ────────────────────────────────────────────────

function GenerationCell({ offer, onRetry }: { offer: OfferRow; onRetry: () => void }) {
  if (offer.offer_type === "tariff") {
    return (
      <a
        href={`/api/offers/${offer.id}/download/`}
        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-warm hover:bg-accent/50"
      >
        <Download size={13} /> Excel
      </a>
    );
  }
  if (offer.generation_status === "generating" || offer.generation_status === "pending") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
        <Loader2 size={13} className="animate-spin" /> Génération…
      </span>
    );
  }
  if (offer.generation_status === "error") {
    return (
      <button
        onClick={onRetry}
        title={offer.generation_error}
        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
      >
        <RefreshCw size={13} /> Réessayer
      </button>
    );
  }
  if (offer.generation_status === "ready" && offer.generated_file_url) {
    return (
      <a
        href={offer.generated_file_url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-warm hover:bg-accent/50"
      >
        <ExternalLink size={13} /> Gamma
      </a>
    );
  }
  return <span className="text-xs text-slate-300">—</span>;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function OffersPage() {
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showNew, setShowNew] = useState(false);

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
      refreshInterval: (d) =>
        d?.results?.some((o) => ["generating", "pending"].includes(o.generation_status)) ? 5000 : 0,
    },
  );
  const { data: dash } = useSWR<Dashboard>("offers-dashboard", () =>
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

  const retry = async (id: string) => {
    try {
      await postJson(`/api/offers/${id}/regenerate/`);
    } finally {
      mutate(`offers:${query}`);
    }
  };

  const offers = data?.results ?? [];

  return (
    <div className="p-6">
      <PageHeader
        title="Offres"
        description="Gestion des offres commerciales"
        actions={
          <button
            onClick={() => setShowNew(true)}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary/90"
          >
            <Plus size={16} /> Nouvelle offre
          </button>
        }
      />

      {dash && (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
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
        </div>
      )}

      <div className="mb-4 flex gap-3">
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-lg border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          <option value="">Tous les types</option>
          <option value="tariff">Tarif</option>
          <option value="project">Projet</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          <option value="">Tous les statuts</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
        {error ? (
          <div className="py-16 text-center text-sm text-slate-400">
            Impossible de charger les offres.
          </div>
        ) : isLoading ? (
          <div className="py-16 text-center text-sm text-slate-400">Chargement…</div>
        ) : offers.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-20 text-slate-400">
            <FileText size={28} className="text-slate-300" />
            <p className="text-sm">Aucune offre. Cliquez « Nouvelle offre » pour en générer une.</p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="border-b border-border bg-background">
              <tr>
                {["Offre", "Type", "Client(s)", "Statut", "Validité", "Document"].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {offers.map((o) => (
                <tr key={o.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/offers/${o.id}`}
                      className="text-sm font-medium text-slate-800 hover:text-warm"
                    >
                      {o.label}
                    </Link>
                    <div className="text-xs text-slate-400">
                      {o.line_count} ligne(s) · {o.currency}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-1 text-xs font-semibold",
                        o.offer_type === "project"
                          ? "bg-purple-100 text-purple-700"
                          : "bg-blue-100 text-blue-700",
                      )}
                    >
                      {o.offer_type === "project" ? "Projet" : "Tarif"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">{clientName(o.client_ids)}</td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-1 text-xs font-semibold",
                        STATUS_COLORS[o.status] ?? "bg-slate-100 text-slate-600",
                      )}
                    >
                      {STATUS_LABELS[o.status] ?? o.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-500">
                    {o.valid_to ? new Date(o.valid_to).toLocaleDateString("fr-FR") : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <GenerationCell offer={o} onRetry={() => retry(o.id)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showNew && <NewOfferModal onClose={() => setShowNew(false)} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-border bg-white px-4 py-3 shadow-sm">
      <div className="text-2xl font-semibold text-slate-800">{value}</div>
      <div className="mt-0.5 text-xs text-slate-500">{label}</div>
    </div>
  );
}
