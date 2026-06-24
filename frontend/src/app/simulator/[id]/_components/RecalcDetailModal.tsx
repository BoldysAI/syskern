"use client";

import * as Dialog from "@radix-ui/react-dialog";
import useSWR from "swr";
import { X } from "lucide-react";
import { getRecalculation, type Recalculation } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatIncotermDisplay } from "@/lib/incoterms";
import { decToPct, fmtEur, mpStr, RECALC_TRIGGER } from "./sim-format";

interface Props {
  simId: string;
  recalcId: string | null;
  onClose: () => void;
}

export function RecalcDetailModal({ simId, recalcId, onClose }: Props) {
  const { data, isLoading } = useSWR<Recalculation>(
    recalcId ? ["recalculation", simId, recalcId] : null,
    () => getRecalculation(simId, recalcId as string)
  );

  return (
    <Dialog.Root open={recalcId != null} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[60] flex max-h-[85vh] w-full max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl bg-white shadow-xl focus:outline-none">
          <div className="flex items-center justify-between border-b border-border p-5">
            <Dialog.Title className="text-lg font-semibold text-slate-900">
              Détail du recalcul
            </Dialog.Title>
            <Dialog.Close className="text-slate-400 hover:text-slate-600" aria-label="Fermer">
              <X size={20} />
            </Dialog.Close>
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            {isLoading || !data ? (
              <div className="py-10 text-center text-sm text-slate-400">Chargement…</div>
            ) : (
              <RecalcDetailBody recalc={data} />
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function RecalcDetailBody({ recalc: r }: { recalc: Recalculation }) {
  const trigger = RECALC_TRIGGER[r.trigger_type] ?? {
    label: r.trigger_type,
    badge: "bg-slate-100 text-slate-600",
  };
  const mp = r.market_params ?? {};
  const a = r.aggregates ?? {};
  const snapshots = r.line_snapshots ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-800">
          {new Date(r.calculated_at).toLocaleString("fr-FR")}
        </span>
        <span className={cn("rounded px-2 py-0.5 text-xs font-medium", trigger.badge)}>
          {trigger.label}
        </span>
      </div>

      {/* Frozen params */}
      <section className="grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
        <Row label="Cuivre base / actuel" value={`${mpStr(mp, "copper_base_price_rmb")} / ${mpStr(mp, "copper_current_price_rmb")} RMB`} />
        <Row label="FX EUR→RMB" value={mpStr(mp, "fx_eur_rmb")} />
        <Row label="FX EUR→USD" value={mpStr(mp, "fx_eur_usd")} />
        <Row label="Mix stock/achat" value={`${r.stock_purchase_mix_pct} %`} />
        <Row label="Marges Syskern / Symea" value={`${decToPct(r.syskern_margin_rate) || "—"} % / ${decToPct(r.symea_margin_rate) || "—"} %`} />
        <Row label="Incoterm vente" value={formatIncotermDisplay(r.sale_incoterm ?? "EXW", r.sale_incoterm_location)} />
        {r.odoo_snapshot_at && (
          <Row label="Snapshot Odoo" value={new Date(r.odoo_snapshot_at).toLocaleString("fr-FR")} />
        )}
      </section>

      {/* Aggregates */}
      <section className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        <Stat label="Lignes" value={String(a.line_count ?? "—")} />
        <Stat label="PA moyen" value={fmtEur(a.avg_pa_eur)} />
        <Stat label="PR moyen" value={fmtEur(a.avg_pr_eur)} />
        <Stat label="PV moyen" value={fmtEur(a.avg_pv_eur)} />
        <Stat label="Marge moy." value={a.avg_margin ? `${decToPct(a.avg_margin)} %` : "—"} />
        <Stat label="PV min / max" value={`${fmtEur(a.min_pv_eur)} / ${fmtEur(a.max_pv_eur)}`} />
      </section>

      {(a.warnings_count || a.errors_count) ? (
        <div className="flex gap-2 text-xs">
          {a.warnings_count ? (
            <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-700">{a.warnings_count} avert.</span>
          ) : null}
          {a.errors_count ? (
            <span className="rounded bg-red-100 px-2 py-0.5 text-red-700">{a.errors_count} err.</span>
          ) : null}
        </div>
      ) : null}

      {r.note && <p className="text-xs italic text-slate-500">{r.note}</p>}

      {/* Per-line breakdown (read-only) */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-800">Résultats par ligne (figés)</h3>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead className="bg-background text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">SKU</th>
                <th className="px-3 py-2 text-left font-semibold">Désignation</th>
                <th className="px-3 py-2 text-right font-semibold">PA</th>
                <th className="px-3 py-2 text-right font-semibold">PR</th>
                <th className="px-3 py-2 text-right font-semibold">PV</th>
                <th className="px-3 py-2 text-right font-semibold">Marge</th>
                <th className="px-3 py-2 text-right font-semibold">Mix</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {snapshots.map((s) => (
                <tr key={s.product_id} className="bg-white even:bg-slate-50/40">
                  <td className="px-3 py-2 font-mono font-semibold text-orange-600">{s.sku}</td>
                  <td className="max-w-[200px] truncate px-3 py-2 text-slate-600" title={s.designation}>
                    {s.designation}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtEur(s.pa_net_eur)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtEur(s.pr_eur)}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">
                    {fmtEur(s.pv_eur)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {s.effective_margin_rate ? `${decToPct(s.effective_margin_rate)} %` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {s.effective_mix_pct != null ? `${s.effective_mix_pct} %` : "—"}
                  </td>
                </tr>
              ))}
              {snapshots.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-slate-400">
                    Aucun détail par ligne pour ce recalcul.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
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
