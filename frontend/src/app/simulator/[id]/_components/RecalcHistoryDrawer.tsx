"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Eye, GitCompare, History, X } from "lucide-react";
import {
  getRecalculations,
  type PaginatedResponse,
  type Recalculation,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { decToPct, fmtEur, mpStr, RECALC_TRIGGER } from "./sim-format";
import { formatIncotermDisplay } from "@/lib/incoterms";
import { RecalcDetailModal } from "./RecalcDetailModal";

interface Props {
  simId: string;
  open: boolean;
  onClose: () => void;
}

const PAGE = 10;

export function RecalcHistoryDrawer({ simId, open, onClose }: Props) {
  const router = useRouter();
  const [limit, setLimit] = useState(PAGE);
  const [detailId, setDetailId] = useState<string | null>(null);

  const { data, isLoading } = useSWR<PaginatedResponse<Recalculation>>(
    open ? ["recalculations", simId, limit] : null,
    () => getRecalculations(simId, { limit })
  );

  if (!open) return null;

  const traces = data?.results ?? [];
  const total = data?.count ?? 0;
  const hasMore = traces.length < total;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-border p-5">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
            <History size={18} className="text-warm" />
            Historique des recalculs
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Fermer">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {isLoading && traces.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-400">Chargement…</div>
          ) : !traces.length ? (
            <div className="py-10 text-center text-sm text-slate-400">
              Aucun recalcul global enregistré.
            </div>
          ) : (
            <>
              <ul className="flex flex-col gap-3">
                {traces.map((r) => (
                  <RecalcEntry
                    key={r.id}
                    recalc={r}
                    onDetail={() => setDetailId(r.id)}
                    onCompare={() =>
                      router.push(`/simulator/compare?sims=${simId}&recalc=${r.id}`)
                    }
                  />
                ))}
              </ul>
              {hasMore && (
                <button
                  onClick={() => setLimit((l) => l + PAGE)}
                  className="mt-4 w-full rounded-lg border border-border py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  Charger plus ({total - traces.length} restant{total - traces.length !== 1 ? "s" : ""})
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <RecalcDetailModal simId={simId} recalcId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}

function RecalcEntry({
  recalc: r,
  onDetail,
  onCompare,
}: {
  recalc: Recalculation;
  onDetail: () => void;
  onCompare: () => void;
}) {
  const trigger = RECALC_TRIGGER[r.trigger_type] ?? {
    label: r.trigger_type,
    badge: "bg-slate-100 text-slate-600",
  };
  const mp = r.market_params ?? {};
  const a = r.aggregates ?? {};

  return (
    <li className="rounded-xl border border-border p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-semibold text-slate-800">
          {new Date(r.calculated_at).toLocaleString("fr-FR")}
        </span>
        <span className={cn("shrink-0 rounded px-2 py-0.5 text-xs font-medium", trigger.badge)}>
          {trigger.label}
        </span>
      </div>

      <div className="mt-3 space-y-2 rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
        <ParamRow
          label="Cuivre (base / actuel)"
          value={`${mpStr(mp, "copper_base_price_rmb")} / ${mpStr(mp, "copper_current_price_rmb")} RMB`}
        />
        <ParamRow label="FX EUR→RMB" value={mpStr(mp, "fx_eur_rmb")} />
        <ParamRow label="FX EUR→USD" value={mpStr(mp, "fx_eur_usd")} />
        <ParamRow
          label="Incoterm vente"
          value={formatIncotermDisplay(r.sale_incoterm ?? "EXW", r.sale_incoterm_location)}
        />
        <ParamRow label="Mix stock/achat" value={`${r.stock_purchase_mix_pct} %`} />
        <ParamRow
          label="Marges SysKern / Symea"
          value={`${decToPct(r.syskern_margin_rate) || "—"} % / ${decToPct(r.symea_margin_rate) || "—"} %`}
        />
        {chainSummary(r.calculation_chain) && (
          <ParamRow label="Chaîne PA / PV" value={chainSummary(r.calculation_chain)!} />
        )}
        {r.odoo_snapshot_at && (
          <ParamRow
            label="Snapshot Odoo"
            value={new Date(r.odoo_snapshot_at).toLocaleString("fr-FR")}
          />
        )}
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
        <Stat label="Lignes" value={String(a.line_count ?? "—")} />
        <Stat label="PA moyen" value={fmtEur(a.avg_pa_eur)} />
        <Stat label="PR moyen" value={fmtEur(a.avg_pr_eur)} />
        <Stat label="PV moyen" value={fmtEur(a.avg_pv_eur)} />
        <Stat label="Marge moy." value={a.avg_margin ? `${decToPct(a.avg_margin)} %` : "—"} />
        <Stat label="PV min/max" value={`${fmtEur(a.min_pv_eur)} / ${fmtEur(a.max_pv_eur)}`} />
      </div>
      {(a.warnings_count || a.errors_count) ? (
        <div className="mt-2 flex gap-2 text-xs">
          {a.warnings_count ? (
            <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-700">
              {a.warnings_count} avert.
            </span>
          ) : null}
          {a.errors_count ? (
            <span className="rounded bg-red-100 px-2 py-0.5 text-red-700">
              {a.errors_count} err.
            </span>
          ) : null}
        </div>
      ) : null}
      {r.note && <p className="mt-2 text-xs italic text-slate-500">{r.note}</p>}

      <div className="mt-3 flex gap-2">
        <button
          onClick={onDetail}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
        >
          <Eye size={13} />
          Voir détail
        </button>
        <button
          onClick={onCompare}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
        >
          <GitCompare size={13} />
          Comparer avec actuel
        </button>
      </div>
    </li>
  );
}

function chainSummary(chain: Record<string, unknown> | undefined): string | null {
  if (!chain) return null;
  let n = 0;
  for (const side of ["purchase_chain", "sale_chain"]) {
    const cfg = chain[side] as Record<string, unknown> | undefined;
    if (!cfg) continue;
    for (const key of ["transports", "customs"]) {
      const arr = cfg[key];
      if (Array.isArray(arr)) n += arr.length;
    }
    if (cfg.symea_margin || cfg.syskern_margin) n += 1;
  }
  return n > 0 ? `${n} module${n > 1 ? "s" : ""}` : null;
}

function ParamRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="font-medium text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-700 tabular-nums">{value}</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white px-2 py-1.5 ring-1 ring-slate-100">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-0.5 font-medium text-slate-700 tabular-nums">{value}</div>
    </div>
  );
}
