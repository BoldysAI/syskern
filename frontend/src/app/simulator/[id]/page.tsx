"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import useSWR from "swr";
import {
  ChevronLeft,
  Calculator,
  CheckCircle2,
  Copy,
  Trash2,
  Plus,
  Loader2,
  AlertCircle,
  Search,
  X,
} from "lucide-react";
import {
  getSimulation,
  recalculate,
  finalizeSimulation,
  duplicateSimulation,
  deleteSimulation,
  addSimulationLines,
  updateSimulationLine,
  deleteSimulationLine,
  getProducts,
  type SimulationDetail,
  type SimulationLine,
  type PaginatedProducts,
} from "@/lib/api";
import { cn } from "@/lib/utils";

function fmtEur(v?: string | null): string {
  if (v == null) return "—";
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return "—";
  return `${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

function decToPct(v?: string | null): string {
  if (v == null) return "";
  const n = parseFloat(v);
  return Number.isFinite(n) ? String(Math.round(n * 10000) / 100) : "";
}

const LINE_STATUS: Record<SimulationLine["status"], { cls: string; label: string }> = {
  ok: { cls: "bg-green-100 text-green-700", label: "OK" },
  pending: { cls: "bg-slate-100 text-slate-500", label: "En attente" },
  warning: { cls: "bg-amber-100 text-amber-700", label: "Avertissement" },
  error: { cls: "bg-red-100 text-red-700", label: "Erreur" },
  dirty: { cls: "bg-orange-100 text-orange-700", label: "Modifié" },
};

// ── Add-products modal ────────────────────────────────────────────────────
function AddProductsModal({
  simulationId,
  existingProductIds,
  onClose,
  onAdded,
}: {
  simulationId: string;
  existingProductIds: Set<string>;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = useSWR<PaginatedProducts>(
    ["sim-add-products", search],
    () => getProducts({ q: search || undefined, limit: 25 }),
    { keepPreviousData: true }
  );

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleAdd = async () => {
    if (selected.size === 0) return;
    setSaving(true);
    try {
      await addSimulationLines(simulationId, [...selected]);
      onAdded();
      onClose();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ajout échoué");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-[#E2E8F0]">
          <h2 className="text-lg font-semibold text-slate-900">Ajouter des produits</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 border-b border-[#E2E8F0]">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher par SKU ou désignation…"
              className="w-full pl-8 pr-3 py-2 text-sm border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#E07200]/30 focus:border-[#E07200]"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="py-10 text-center text-sm text-slate-400">Chargement…</div>
          ) : !data?.results.length ? (
            <div className="py-10 text-center text-sm text-slate-400">Aucun produit trouvé</div>
          ) : (
            <ul className="divide-y divide-[#E2E8F0]">
              {data.results.map((p) => {
                const already = existingProductIds.has(p.id);
                const checked = selected.has(p.id);
                return (
                  <li key={p.id}>
                    <label
                      className={cn(
                        "flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-slate-50",
                        already && "opacity-40 cursor-not-allowed"
                      )}
                    >
                      <input
                        type="checkbox"
                        disabled={already}
                        checked={checked || already}
                        onChange={() => !already && toggle(p.id)}
                        className="w-4 h-4 rounded border-slate-300 accent-[#E07200]"
                      />
                      <span className="font-mono text-sm font-semibold text-slate-800 w-44 truncate">
                        {p.sku_code}
                      </span>
                      <span className="text-sm text-slate-600 truncate flex-1">{p.name}</span>
                      {already && <span className="text-xs text-slate-400">déjà ajouté</span>}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 p-4 border-t border-[#E2E8F0]">
          <span className="text-sm text-slate-500">{selected.size} sélectionné(s)</span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm border border-[#E2E8F0] rounded-lg hover:bg-slate-50 text-slate-600"
            >
              Annuler
            </button>
            <button
              onClick={handleAdd}
              disabled={selected.size === 0 || saving}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-[#E07200] hover:bg-[#C56400] text-white rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              Ajouter
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Inline override input ─────────────────────────────────────────────────
function OverrideInput({
  value,
  suffix,
  disabled,
  onCommit,
}: {
  value: string;
  suffix: string;
  disabled: boolean;
  onCommit: (raw: string) => void;
}) {
  const [v, setV] = useState(value);
  return (
    <div className="flex items-center gap-1">
      <input
        value={v}
        disabled={disabled}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => v !== value && onCommit(v)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        placeholder="—"
        className="w-14 px-1.5 py-1 text-sm text-right border border-transparent hover:border-[#E2E8F0] focus:border-[#E07200] rounded focus:outline-none disabled:bg-transparent disabled:hover:border-transparent"
      />
      <span className="text-xs text-slate-400">{suffix}</span>
    </div>
  );
}

export default function SimulationDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id ?? "";

  const { data: sim, isLoading, error, mutate } = useSWR<SimulationDetail>(
    id ? ["simulation", id] : null,
    () => getSimulation(id)
  );

  const [showAdd, setShowAdd] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const readOnly = sim?.status !== "draft";

  const run = async (action: string, fn: () => Promise<unknown>) => {
    setBusy(action);
    try {
      await fn();
      await mutate();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Action échouée");
    } finally {
      setBusy(null);
    }
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-500 p-10">
        <AlertCircle size={40} className="text-red-300" />
        <p className="font-medium">Simulation introuvable</p>
        <p className="text-sm text-slate-400">{error?.message}</p>
        <Link href="/simulator" className="text-sm text-[#E07200] hover:text-[#C56400] font-medium mt-2">
          Retour aux simulations
        </Link>
      </div>
    );
  }

  const lines = sim?.lines ?? [];
  const okLines = lines.filter((l) => l.pv_eur != null);
  const avgPv =
    okLines.length > 0
      ? okLines.reduce((s, l) => s + parseFloat(l.pv_eur as string), 0) / okLines.length
      : null;
  const errorCount = lines.filter((l) => l.status === "error").length;

  return (
    <div className="p-6">
      <Link
        href="/simulator"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-4"
      >
        <ChevronLeft size={16} />
        Retour aux simulations
      </Link>

      {/* Header */}
      <div className="bg-white border border-[#E2E8F0] rounded-xl p-5 shadow-sm mb-6">
        {isLoading || !sim ? (
          <div className="h-8 w-64 animate-pulse bg-slate-200 rounded" />
        ) : (
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-bold text-slate-900">{sim.label}</h1>
                <span
                  className={cn(
                    "inline-flex px-2 py-0.5 rounded text-xs font-semibold",
                    sim.status === "finalized"
                      ? "bg-green-100 text-green-700"
                      : sim.status === "archived"
                      ? "bg-slate-100 text-slate-500"
                      : "bg-amber-100 text-amber-700"
                  )}
                >
                  {sim.status === "finalized" ? "Finalisé" : sim.status === "archived" ? "Archivé" : "Brouillon"}
                </span>
                {sim.is_dirty && sim.status === "draft" && (
                  <span className="text-xs text-orange-600 font-medium">Recalcul nécessaire</span>
                )}
              </div>
              <p className="text-sm text-slate-500 mt-1">
                {sim.simulation_type === "tariff" ? "Tarif" : "Projet"}
                {sim.project_name ? ` · ${sim.project_name}` : ""} · {sim.line_count} ligne
                {sim.line_count !== 1 ? "s" : ""}
                {sim.last_calculated_at
                  ? ` · calculé le ${new Date(sim.last_calculated_at).toLocaleDateString("fr-FR")}`
                  : ""}
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {!readOnly && (
                <>
                  <button
                    onClick={() => run("recalc", () => recalculate(id))}
                    disabled={busy !== null}
                    className="flex items-center gap-2 px-3 py-2 text-sm bg-[#E07200] hover:bg-[#C56400] text-white rounded-lg font-medium transition-colors disabled:opacity-50"
                  >
                    {busy === "recalc" ? <Loader2 size={14} className="animate-spin" /> : <Calculator size={14} />}
                    Recalculer
                  </button>
                  <button
                    onClick={() => run("finalize", () => finalizeSimulation(id))}
                    disabled={busy !== null || sim.is_dirty || lines.length === 0}
                    title={sim.is_dirty ? "Recalculez avant de finaliser" : undefined}
                    className="flex items-center gap-2 px-3 py-2 text-sm border border-green-300 text-green-700 hover:bg-green-50 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <CheckCircle2 size={14} />
                    Finaliser
                  </button>
                </>
              )}
              <button
                onClick={() =>
                  run("duplicate", async () => {
                    const dup = await duplicateSimulation(id);
                    router.push(`/simulator/${dup.id}`);
                  })
                }
                disabled={busy !== null}
                className="flex items-center gap-2 px-3 py-2 text-sm border border-[#E2E8F0] text-slate-600 hover:bg-slate-50 rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                <Copy size={14} />
                Dupliquer
              </button>
              {!readOnly && (
                <button
                  onClick={() => {
                    if (!confirm(`Supprimer la simulation « ${sim.label} » ?`)) return;
                    run("delete", async () => {
                      await deleteSimulation(id);
                      router.push("/simulator");
                    });
                  }}
                  disabled={busy !== null}
                  className="flex items-center gap-2 px-3 py-2 text-sm border border-red-200 text-red-600 hover:bg-red-50 rounded-lg font-medium transition-colors disabled:opacity-50"
                >
                  <Trash2 size={14} />
                  Supprimer
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Summary cards */}
      {sim && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 shadow-sm">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Lignes</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{sim.line_count}</div>
          </div>
          <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 shadow-sm">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">PV moyen</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">
              {avgPv != null ? fmtEur(String(avgPv)) : "—"}
            </div>
          </div>
          <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 shadow-sm">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Marge Syskern</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{decToPct(sim.syskern_margin_rate)} %</div>
          </div>
          <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 shadow-sm">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Erreurs</div>
            <div className={cn("text-2xl font-bold mt-1", errorCount ? "text-red-600" : "text-slate-900")}>
              {errorCount}
            </div>
          </div>
        </div>
      )}

      {/* Lines */}
      <div className="bg-white border border-[#E2E8F0] rounded-xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E2E8F0]">
          <h2 className="text-sm font-semibold text-slate-700">Lignes de produits</h2>
          {!readOnly && (
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm bg-[#E07200] hover:bg-[#C56400] text-white rounded-lg font-medium transition-colors"
            >
              <Plus size={14} />
              Ajouter des produits
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="py-16 text-center text-sm text-slate-400">Chargement…</div>
        ) : lines.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <Calculator size={36} className="mx-auto mb-3 text-slate-200" />
            <p className="text-sm">Aucune ligne. Ajoutez des produits pour démarrer.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-[#F5F7FA] border-b border-[#E2E8F0]">
                <tr>
                  {["SKU", "Désignation", "PA net", "PR", "PV", "Marge", "Mix", "Statut", ""].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0]">
                {lines.map((line) => {
                  const st = LINE_STATUS[line.status] ?? LINE_STATUS.pending;
                  return (
                    <tr key={line.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-mono text-sm font-semibold text-slate-800">
                        {line.product_sku}
                      </td>
                      <td className="px-4 py-2.5 text-sm text-slate-600 max-w-xs truncate">
                        {line.product_name}
                      </td>
                      <td className="px-4 py-2.5 text-sm text-slate-700">{fmtEur(line.pa_net_eur)}</td>
                      <td className="px-4 py-2.5 text-sm text-slate-700">{fmtEur(line.pr_eur)}</td>
                      <td className="px-4 py-2.5 text-sm font-semibold text-slate-900">{fmtEur(line.pv_eur)}</td>
                      <td className="px-4 py-2.5">
                        <OverrideInput
                          value={decToPct(line.margin_override)}
                          suffix="%"
                          disabled={readOnly || busy !== null}
                          onCommit={(raw) =>
                            run("line", () =>
                              updateSimulationLine(line.id, {
                                margin_override:
                                  raw.trim() === "" ? null : (parseFloat(raw) / 100).toFixed(4),
                              })
                            )
                          }
                        />
                      </td>
                      <td className="px-4 py-2.5">
                        <OverrideInput
                          value={line.stock_purchase_mix_pct_override?.toString() ?? ""}
                          suffix="%"
                          disabled={readOnly || busy !== null}
                          onCommit={(raw) =>
                            run("line", () =>
                              updateSimulationLine(line.id, {
                                stock_purchase_mix_pct_override:
                                  raw.trim() === "" ? null : parseInt(raw, 10),
                              })
                            )
                          }
                        />
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={cn("inline-flex px-2 py-0.5 rounded text-xs font-medium", st.cls)}>
                          {st.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        {!readOnly && (
                          <button
                            onClick={() => run("line", () => deleteSimulationLine(line.id))}
                            disabled={busy !== null}
                            className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                            title="Retirer"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAdd && sim && (
        <AddProductsModal
          simulationId={id}
          existingProductIds={new Set(lines.map((l) => l.product))}
          onClose={() => setShowAdd(false)}
          onAdded={() => mutate()}
        />
      )}
    </div>
  );
}
