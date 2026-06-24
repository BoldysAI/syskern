"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import useSWR from "swr";
import {
  ArrowLeft,
  Clock,
  Download,
  ExternalLink,
  GitBranch,
  Loader2,
  Send,
  ThumbsDown,
  Trophy,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

interface OfferLine {
  id: string;
  product_sku: string;
  product_name: string;
  final_price: string;
  quantity: string | null;
  display_order: number;
}
interface OfferDetail {
  id: string;
  label: string;
  offer_type: "tariff" | "project";
  status: string;
  currency: string;
  language: string;
  project_name: string;
  client_ids: string[];
  version_number: number;
  valid_to: string | null;
  simulation: string;
  generation_status: string;
  generated_file_url: string;
  generation_error: string;
  project_info: Record<string, unknown>;
  lines: OfferLine[];
}
interface VersionRow {
  id: string;
  version_number: number;
  status: string;
}
interface ClientLite {
  id: string;
  name: string;
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
async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrfToken() },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d?.detail ?? "Erreur serveur");
  }
  return res.json();
}
async function patchStatus(id: string, status: string) {
  const res = await fetch(`/api/offers/${id}/status/`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrfToken() },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d?.detail ?? "Transition refusée");
  }
}

function daysUntil(date: string | null): number | null {
  if (!date) return null;
  const ms = new Date(date).getTime() - Date.now();
  return Math.ceil(ms / 86_400_000);
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function OfferDetailPage() {
  const id = String(useParams().id);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extendOpen, setExtendOpen] = useState(false);
  const [extendDate, setExtendDate] = useState("");

  const { data: offer, mutate } = useSWR<OfferDetail>(`offer:${id}`, () =>
    getJson<OfferDetail>(`/api/offers/${id}/`),
  );
  const { data: versions } = useSWR<VersionRow[]>(
    offer?.offer_type === "project" ? `offer-versions:${id}` : null,
    () => getJson<VersionRow[]>(`/api/offers/${id}/versions/`),
  );
  const { data: clientsResp } = useSWR("clients:all", () =>
    getJson<{ results?: ClientLite[] } | ClientLite[]>("/api/clients/?limit=1000"),
  );
  const clientName = (() => {
    const list = Array.isArray(clientsResp) ? clientsResp : (clientsResp?.results ?? []);
    const map = new Map(list.map((c) => [c.id, c.name]));
    return (offer?.client_ids ?? []).map((i) => map.get(i) ?? "—").join(", ") || "—";
  })();

  if (!offer) {
    return <div className="p-6 text-sm text-slate-400">Chargement…</div>;
  }

  const isProject = offer.offer_type === "project";
  const remaining = daysUntil(offer.valid_to);
  const total = offer.lines.reduce(
    (sum, l) => sum + Number(l.final_price) * (l.quantity ? Number(l.quantity) : 1),
    0,
  );

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await mutate();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  };

  const newVersion = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await postJson<{ id: string }>(`/api/offers/${id}/new-version/`);
      router.push(`/offers/${created.id}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erreur");
      setBusy(false);
    }
  };

  const extend = async () => {
    if (!extendDate) return;
    await run(async () => {
      await postJson(`/api/offers/${id}/extend-expiration/`, { new_date: extendDate });
      setExtendOpen(false);
    });
  };

  return (
    <div className="mx-auto max-w-4xl p-6">
      <Link
        href="/offers"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft size={15} /> Offres
      </Link>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-slate-900">
              {offer.project_name || offer.label}
            </h1>
            <span
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-semibold",
                STATUS_COLORS[offer.status] ?? "bg-slate-100 text-slate-600",
              )}
            >
              {STATUS_LABELS[offer.status] ?? offer.status}
            </span>
            <span
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-semibold",
                isProject ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700",
              )}
            >
              {isProject ? "Projet" : "Tarif"} · V{offer.version_number}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {clientName} · {offer.currency} · {offer.language.toUpperCase()}
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Info cards */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Info label="Simulation source">
          <Link href={`/simulator/${offer.simulation}`} className="text-warm hover:underline">
            Ouvrir
          </Link>
        </Info>
        <Info label="Expiration">
          {offer.valid_to ? (
            <span
              className={cn(
                "inline-flex items-center gap-1.5",
                remaining != null && remaining <= 7 ? "text-amber-600" : "text-slate-700",
              )}
            >
              <Clock size={14} />
              {new Date(offer.valid_to).toLocaleDateString("fr-FR")}
              {remaining != null && (
                <span className="text-xs">
                  ({remaining < 0 ? "expirée" : `dans ${remaining} j`})
                </span>
              )}
            </span>
          ) : (
            "—"
          )}
        </Info>
        <Info label="Total estimé">
          {total.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} {offer.currency}
        </Info>
      </div>

      {/* Files */}
      <div className="mb-5 rounded-xl border border-border bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Document</h2>
        {isProject ? (
          offer.generation_status === "ready" && offer.generated_file_url ? (
            <a
              href={offer.generated_file_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90"
            >
              Ouvrir le devis Gamma <ExternalLink size={14} />
            </a>
          ) : offer.generation_status === "error" ? (
            <span className="text-sm text-red-600">
              Génération en erreur : {offer.generation_error}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-sm text-slate-400">
              <Loader2 size={14} className="animate-spin" /> Génération en cours…
            </span>
          )
        ) : (
          <a
            href={`/api/offers/${id}/download/`}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90"
          >
            <Download size={14} /> Télécharger l&apos;Excel
          </a>
        )}
      </div>

      {/* Version chain */}
      {isProject && versions && versions.length > 1 && (
        <div className="mb-5 rounded-xl border border-border bg-white p-4 shadow-sm">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
            <GitBranch size={15} /> Versions
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            {versions.map((v, i) => (
              <span key={v.id} className="flex items-center gap-2">
                <Link
                  href={`/offers/${v.id}`}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-sm",
                    v.id === offer.id
                      ? "border-primary bg-accent font-semibold text-accent-foreground"
                      : "border-border text-slate-600 hover:bg-slate-50",
                  )}
                >
                  V{v.version_number}
                  <span className="ml-1.5 text-xs text-slate-400">
                    {STATUS_LABELS[v.status] ?? v.status}
                  </span>
                </Link>
                {i < versions.length - 1 && <span className="text-slate-300">→</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Lines */}
      <div className="mb-5 overflow-hidden rounded-xl border border-border bg-white shadow-sm">
        <h2 className="border-b border-border px-4 py-3 text-sm font-semibold text-slate-800">
          Lignes ({offer.lines.length})
        </h2>
        <table className="w-full text-sm">
          <thead className="bg-background text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2 text-left">SKU</th>
              <th className="px-4 py-2 text-left">Désignation</th>
              {isProject && <th className="px-4 py-2 text-right">Qté</th>}
              <th className="px-4 py-2 text-right">PU ({offer.currency})</th>
              {isProject && <th className="px-4 py-2 text-right">Total</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {offer.lines.map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-2 font-medium text-slate-700">{l.product_sku}</td>
                <td className="px-4 py-2 text-slate-600">{l.product_name}</td>
                {isProject && (
                  <td className="px-4 py-2 text-right">{l.quantity ? Number(l.quantity) : "—"}</td>
                )}
                <td className="px-4 py-2 text-right">{Number(l.final_price).toFixed(2)}</td>
                {isProject && (
                  <td className="px-4 py-2 text-right">
                    {(Number(l.final_price) * (l.quantity ? Number(l.quantity) : 1)).toFixed(2)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Lifecycle actions */}
      <div className="flex flex-wrap gap-3">
        {offer.status === "draft" && (
          <ActionBtn icon={Send} onClick={() => run(() => patchStatus(id, "sent"))} busy={busy}>
            Marquer envoyée
          </ActionBtn>
        )}
        {isProject && offer.status === "sent" && (
          <>
            <ActionBtn
              icon={Trophy}
              tone="green"
              onClick={() => run(() => patchStatus(id, "won"))}
              busy={busy}
            >
              Gagnée
            </ActionBtn>
            <ActionBtn
              icon={ThumbsDown}
              tone="red"
              onClick={() => run(() => patchStatus(id, "lost"))}
              busy={busy}
            >
              Perdue
            </ActionBtn>
          </>
        )}
        <ActionBtn icon={Clock} tone="ghost" onClick={() => setExtendOpen(true)} busy={busy}>
          Prolonger l&apos;expiration
        </ActionBtn>
        {isProject && (
          <ActionBtn icon={GitBranch} tone="ghost" onClick={newVersion} busy={busy}>
            Nouvelle version
          </ActionBtn>
        )}
      </div>

      {extendOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-semibold text-slate-900">
              Prolonger l&apos;expiration
            </h2>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              Nouvelle date (&gt; 7 jours)
            </label>
            <input
              type="date"
              value={extendDate}
              onChange={(e) => setExtendDate(e.target.value)}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <div className="mt-5 flex gap-3">
              <button
                onClick={() => setExtendOpen(false)}
                className="flex-1 rounded-lg border border-border py-2.5 text-sm text-slate-600 hover:bg-slate-50"
              >
                Annuler
              </button>
              <button
                onClick={extend}
                disabled={!extendDate || busy}
                className="flex-1 rounded-lg bg-primary py-2.5 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
              >
                Valider
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-white px-4 py-3 shadow-sm">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-medium text-slate-800">{children}</div>
    </div>
  );
}

function ActionBtn({
  children,
  icon: Icon,
  onClick,
  busy,
  tone = "primary",
}: {
  children: React.ReactNode;
  icon: React.ElementType;
  onClick: () => void;
  busy: boolean;
  tone?: "primary" | "green" | "red" | "ghost";
}) {
  const tones: Record<string, string> = {
    primary: "bg-primary text-white hover:bg-primary/90",
    green: "bg-green-600 text-white hover:bg-green-700",
    red: "bg-red-600 text-white hover:bg-red-700",
    ghost: "border border-border text-slate-600 hover:bg-slate-50",
  };
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={cn(
        "inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold disabled:opacity-50",
        tones[tone],
      )}
    >
      <Icon size={15} /> {children}
    </button>
  );
}
