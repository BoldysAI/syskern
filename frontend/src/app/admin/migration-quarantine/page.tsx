"use client";

import { useMemo, useState } from "react";
import useSWR, { mutate } from "swr";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, FileWarning, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;

const REASON_LABELS: Record<string, string> = {
  no_sku: "SKU manquant",
  no_match: "Aucune correspondance",
  duplicate_match: "Correspondances multiples",
  invalid_format: "Format invalide",
  missing_required_field: "Champ requis manquant",
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
  created_at: string;
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

async function resolveRow(id: string, resolvedBy: string, notes: string) {
  const res = await fetch(`/api/migration/unmatched/${id}/resolve/`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrfToken() },
    body: JSON.stringify({ resolved_by: resolvedBy, resolution_notes: notes }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.resolved_by?.[0] ?? data?.detail ?? "Erreur serveur");
  }
  return res.json();
}

function ReasonBadge({ reason }: { reason: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
      {REASON_LABELS[reason] ?? reason}
    </span>
  );
}

function DetailModal({
  row,
  defaultEmail,
  onClose,
}: {
  row: UnmatchedRow;
  defaultEmail: string;
  onClose: () => void;
}) {
  const [notes, setNotes] = useState("");
  const [resolvedBy, setResolvedBy] = useState(defaultEmail);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isResolved = !!row.resolved_at;

  const handleResolve = async () => {
    setError(null);
    setLoading(true);
    try {
      await resolveRow(row.id, resolvedBy, notes);
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              {row.source_file}
              {row.source_row_number != null && (
                <span className="text-slate-400 font-normal"> · ligne {row.source_row_number}</span>
              )}
            </h2>
            <div className="mt-1">
              <ReasonBadge reason={row.reason} />
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          <div>
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
              Données brutes
            </h3>
            <pre className="text-xs bg-background border border-border rounded-lg p-4 overflow-x-auto text-slate-700">
              {JSON.stringify(row.raw_data, null, 2)}
            </pre>
          </div>

          {isResolved ? (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm">
              <div className="flex items-center gap-2 text-green-700 font-medium mb-1">
                <CheckCircle2 size={15} /> Résolue
              </div>
              <div className="text-slate-600">
                Par {row.resolved_by} le {new Date(row.resolved_at!).toLocaleString("fr-FR")}
              </div>
              {row.resolution_notes && (
                <div className="mt-2 text-slate-600 whitespace-pre-wrap">
                  {row.resolution_notes}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-slate-500">
                Pas de ré-injection automatique : créez le produit manuellement via{" "}
                <span className="font-medium">Catalogue → Nouveau produit</span>, puis marquez la
                ligne résolue.
              </p>
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  {error}
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Résolue par (e-mail) *
                </label>
                <input
                  type="email"
                  value={resolvedBy}
                  onChange={(e) => setResolvedBy(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Note</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Ex : produit créé manuellement (SKU …), ou ligne ignorée car doublon."
                  className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
              </div>
              <div className="flex gap-3 pt-1">
                <button
                  onClick={onClose}
                  className="flex-1 py-2.5 text-sm border border-border rounded-lg hover:bg-slate-50 text-slate-600"
                >
                  Annuler
                </button>
                <button
                  onClick={handleResolve}
                  disabled={loading || !resolvedBy}
                  className="flex-1 py-2.5 text-sm bg-primary hover:bg-primary/90 text-white rounded-lg font-semibold disabled:opacity-60"
                >
                  {loading ? "Enregistrement…" : "Marquer résolu"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="bg-white border border-border rounded-xl px-4 py-3 shadow-sm">
      <div className={cn("text-2xl font-semibold", tone)}>{value}</div>
      <div className="text-xs text-slate-500 mt-0.5">{label}</div>
    </div>
  );
}

export default function MigrationQuarantinePage() {
  const { role, user } = useAuth();
  const router = useRouter();

  const [sourceFile, setSourceFile] = useState("");
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState<"" | "true" | "false">("");
  const [offset, setOffset] = useState(0);
  const [detailRow, setDetailRow] = useState<UnmatchedRow | null>(null);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    p.set("limit", String(PAGE_SIZE));
    p.set("offset", String(offset));
    if (sourceFile) p.set("source_file", sourceFile);
    if (reason) p.set("reason", reason);
    if (status) p.set("resolved", status);
    return p.toString();
  }, [sourceFile, reason, status, offset]);

  const { data, isLoading, error } = useSWR<Paginated<UnmatchedRow>>(`quarantine:${query}`, () =>
    fetcher<Paginated<UnmatchedRow>>(`/api/migration/unmatched/?${query}`),
  );
  const { data: facets } = useSWR<Facets>("quarantine-facets", () =>
    fetcher<Facets>("/api/migration/unmatched/facets/"),
  );

  if (role !== "admin") {
    router.replace("/catalog");
    return null;
  }

  const resetPaging = () => setOffset(0);
  const totalPages = data ? Math.max(1, Math.ceil(data.count / PAGE_SIZE)) : 1;
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Quarantaine de migration</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Lignes non matchables lors de l&apos;import initial (CDC §8.7). À traiter manuellement —
          pas de ré-injection automatique.
        </p>
      </div>

      {facets && (
        <div className="grid grid-cols-3 gap-3 mb-5 max-w-xl">
          <StatCard label="Total" value={facets.total} tone="text-slate-800" />
          <StatCard label="À traiter" value={facets.unresolved} tone="text-amber-600" />
          <StatCard label="Résolues" value={facets.resolved} tone="text-green-600" />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <select
          value={sourceFile}
          onChange={(e) => {
            setSourceFile(e.target.value);
            resetPaging();
          }}
          className="px-3 py-2 text-sm border border-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          <option value="">Tous les fichiers</option>
          {facets?.source_files.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <select
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            resetPaging();
          }}
          className="px-3 py-2 text-sm border border-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          <option value="">Toutes les raisons</option>
          {Object.entries(REASON_LABELS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as "" | "true" | "false");
            resetPaging();
          }}
          className="px-3 py-2 text-sm border border-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          <option value="">Tous les statuts</option>
          <option value="false">À traiter</option>
          <option value="true">Résolues</option>
        </select>
      </div>

      <div className="bg-white border border-border rounded-xl shadow-sm overflow-hidden">
        {error ? (
          <div className="py-16 text-center text-slate-400 text-sm">
            Impossible de charger la quarantaine.
          </div>
        ) : isLoading ? (
          <div className="py-16 text-center text-slate-400 text-sm">Chargement…</div>
        ) : !data || data.results.length === 0 ? (
          <div className="py-16 flex flex-col items-center text-slate-400 text-sm gap-2">
            <FileWarning size={28} className="text-slate-300" />
            Aucune ligne en quarantaine pour ces filtres.
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-background border-b border-border">
              <tr>
                {["Fichier source", "Ligne", "Raison", "Statut", ""].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.results.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 text-sm text-slate-700">{r.source_file}</td>
                  <td className="px-4 py-3 text-sm text-slate-500">{r.source_row_number ?? "—"}</td>
                  <td className="px-4 py-3">
                    <ReasonBadge reason={r.reason} />
                  </td>
                  <td className="px-4 py-3">
                    {r.resolved_at ? (
                      <span className="inline-flex items-center gap-1 text-xs text-green-600 font-medium">
                        <CheckCircle2 size={13} /> Résolue
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-amber-600 font-medium">
                        <AlertTriangle size={13} /> À traiter
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setDetailRow(r)}
                      className="px-3 py-1.5 text-xs font-medium text-warm hover:bg-accent/50 rounded-lg transition-colors"
                    >
                      {r.resolved_at ? "Voir" : "Voir / Résoudre"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {data && data.count > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-4 text-sm text-slate-500">
          <span>
            {data.count} ligne{data.count !== 1 ? "s" : ""} · page {currentPage}/{totalPages}
          </span>
          <div className="flex gap-2">
            <button
              disabled={!data.previous}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              className="px-3 py-1.5 border border-border rounded-lg disabled:opacity-40 hover:bg-slate-50"
            >
              Précédent
            </button>
            <button
              disabled={!data.next}
              onClick={() => setOffset(offset + PAGE_SIZE)}
              className="px-3 py-1.5 border border-border rounded-lg disabled:opacity-40 hover:bg-slate-50"
            >
              Suivant
            </button>
          </div>
        </div>
      )}

      {detailRow && (
        <DetailModal
          row={detailRow}
          defaultEmail={user?.email ?? ""}
          onClose={() => setDetailRow(null)}
        />
      )}
    </div>
  );
}
