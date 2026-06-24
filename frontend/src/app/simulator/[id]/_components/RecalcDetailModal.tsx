"use client";

import useSWR from "swr";
import { getRecalculation, type Recalculation } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatIncotermDisplay } from "@/lib/incoterms";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { decToPct, fmtEur, mpStr, RECALC_TRIGGER, recalcTriggerLabel } from "./sim-format";

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
    <Dialog open={recalcId != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[90vh] max-w-6xl flex-col gap-0 p-0 sm:max-w-6xl">
        <DialogHeader className="border-b border-border p-5">
          <DialogTitle>Détail du recalcul</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-5">
          {isLoading || !data ? (
            <div className="space-y-3">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-24 w-full rounded-lg" />
              <Skeleton className="h-32 w-full rounded-lg" />
            </div>
          ) : (
            <RecalcDetailBody recalc={data} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RecalcDetailBody({ recalc: r }: { recalc: Recalculation }) {
  const triggerLabel = recalcTriggerLabel(r.trigger_type);
  const triggerBadge =
    RECALC_TRIGGER[r.trigger_type]?.badge ?? "bg-muted text-muted-foreground";
  const mp = r.market_params ?? {};
  const a = r.aggregates ?? {};
  const snapshots = r.line_snapshots ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">
          {new Date(r.calculated_at).toLocaleString("fr-FR")}
        </span>
        <span className={cn("rounded px-2 py-0.5 text-xs font-medium", triggerBadge)}>
          {triggerLabel}
        </span>
      </div>

      <section className="grid grid-cols-1 gap-x-6 gap-y-2 rounded-lg bg-muted p-4 text-sm text-muted-foreground sm:grid-cols-2">
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

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
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
            <span className="rounded border border-warm/30 bg-warm/10 px-2 py-0.5 text-warm">{a.warnings_count} avert.</span>
          ) : null}
          {a.errors_count ? (
            <span className="rounded bg-destructive/10 px-2 py-0.5 text-destructive">{a.errors_count} err.</span>
          ) : null}
        </div>
      ) : null}

      {r.note && <p className="text-xs italic text-muted-foreground">{r.note}</p>}

      <section>
        <h3 className="mb-2 text-sm font-semibold text-foreground">Résultats par ligne (figés)</h3>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-muted-foreground">
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
                <tr key={s.product_id} className="even:bg-muted/30">
                  <td className="px-3 py-2 font-mono font-semibold text-warm">{s.sku}</td>
                  <td className="max-w-[200px] truncate px-3 py-2 text-muted-foreground" title={s.designation}>
                    {s.designation}
                  </td>
                  <td className="px-3 py-2 text-right font-data">{fmtEur(s.pa_net_eur)}</td>
                  <td className="px-3 py-2 text-right font-data">{fmtEur(s.pr_eur)}</td>
                  <td className="px-3 py-2 text-right font-semibold font-data text-foreground">
                    {fmtEur(s.pv_eur)}
                  </td>
                  <td className="px-3 py-2 text-right font-data">
                    {s.effective_margin_rate ? `${decToPct(s.effective_margin_rate)} %` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-data">
                    {s.effective_mix_pct != null ? `${s.effective_mix_pct} %` : "—"}
                  </td>
                </tr>
              ))}
              {snapshots.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
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
    <div className="flex justify-between gap-4">
      <span className="shrink-0 font-medium">{label}</span>
      <span className="text-right font-medium text-foreground font-data whitespace-nowrap">{value}</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-card px-2 py-1.5 ring-1 ring-border">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-medium text-foreground font-data">{value}</div>
    </div>
  );
}
