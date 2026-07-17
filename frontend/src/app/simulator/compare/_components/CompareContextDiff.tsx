"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { Equals, PencilSimple } from "@phosphor-icons/react";
import type { CompareColumn } from "@/lib/api";
import { RECALC_TRIGGER } from "@/app/simulator/[id]/_components/sim-format";
import { buildSimulationHref, type SimulationNavigationContext } from "@/lib/simulation-navigation";
import { cn } from "@/lib/utils";
import {
  buildDiffSections,
  countDiffs,
  diffKind,
  fmtDelta,
  type DiffKind,
  type DiffRow,
} from "./compare-diff";
import { columnVisuals } from "./compare-colors";
import { CompareSimulationParamsSheet } from "./CompareSimulationParamsSheet";

interface Props {
  columns: CompareColumn[];
  canEdit?: boolean;
  simulationNavContext?: SimulationNavigationContext;
  onSimulationReplaced?: (sourceId: string, effectiveId: string) => void;
}

export function CompareContextDiff({
  columns,
  canEdit = false,
  simulationNavContext = { kind: "default" },
  onSimulationReplaced,
}: Props) {
  const sections = useMemo(() => buildDiffSections(columns), [columns]);
  const diffCount = useMemo(() => countDiffs(sections), [sections]);
  const baseKey = columns[0]?.key ?? "";
  const visuals = useMemo(
    () => columnVisuals(columns.map((c) => c.label), columns.map((c) => c.key)),
    [columns],
  );

  const [editingColumn, setEditingColumn] = useState<CompareColumn | null>(null);

  const handleSaved = ({ sourceId, effectiveId }: { sourceId: string; effectiveId: string }) => {
    if (sourceId !== effectiveId) {
      onSimulationReplaced?.(sourceId, effectiveId);
    } else {
      onSimulationReplaced?.(sourceId, effectiveId);
    }
    setEditingColumn(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-gradient-to-r from-slate-50 to-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">Légende</span>
          <LegendSwatch kind="same" label="Identique" />
          <LegendSwatch kind="changed" label="Modifié" />
          <LegendSwatch kind="added" label="Ajouté" />
          <LegendSwatch kind="missing" label="Absent" />
        </div>
        {diffCount === 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800">
            <Equals size={13} />
            Tous les paramètres sont identiques
          </span>
        ) : (
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
            {diffCount} écart{diffCount !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="sticky left-0 z-20 min-w-[200px] bg-muted/40 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Paramètre
              </th>
              {visuals.map((v, i) => {
                const col = columns[i];
                const isLiveSim = col.type === "simulation";
                return (
                  <th
                    key={v.key}
                    className={cn(
                      "min-w-[180px] px-4 py-3 text-left align-bottom",
                      v.isRef && "bg-warm/5",
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <span
                        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                        style={{ backgroundColor: v.color }}
                      >
                        {String.fromCharCode(65 + i)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <Link
                          href={buildSimulationHref(col.simulation_id, simulationNavContext)}
                          className="block truncate text-sm font-semibold text-foreground hover:text-warm"
                          title={v.label}
                        >
                          {v.shortLabel}
                        </Link>
                        {v.isRef ? (
                          <span className="mt-0.5 inline-block rounded bg-orange-100 px-1.5 py-0.5 text-[9px] font-semibold text-orange-700">
                            référence
                          </span>
                        ) : (
                          <span className="mt-0.5 block text-[10px] text-muted-foreground">
                            vs réf.
                          </span>
                        )}
                        {canEdit && isLiveSim && (
                          <button
                            type="button"
                            onClick={() => setEditingColumn(col)}
                            className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[10px] font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                          >
                            <PencilSimple size={11} />
                            Modifier
                          </button>
                        )}
                        {canEdit && !isLiveSim && (
                          <span
                            className="mt-1.5 block text-[10px] text-muted-foreground"
                            title="Les snapshots de recalcul sont figés"
                          >
                            Snapshot figé
                          </span>
                        )}
                      </div>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sections.map((section) => (
              <Fragment key={section.title}>
                <tr className="border-y border-border bg-muted/30">
                  <td
                    colSpan={columns.length + 1}
                    className="sticky left-0 z-10 bg-muted/30 px-4 py-2 text-xs font-bold uppercase tracking-wide text-foreground"
                  >
                    {section.title}
                  </td>
                </tr>
                {section.rows.map((row) => (
                  <ParamDiffRow key={row.id} row={row} visuals={visuals} baseKey={baseKey} />
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <CompareSimulationParamsSheet
        simulationId={editingColumn?.simulation_id ?? null}
        simulationLabel={editingColumn?.label ?? ""}
        simulationStatus={editingColumn?.status ?? null}
        open={editingColumn != null}
        onClose={() => setEditingColumn(null)}
        onSaved={handleSaved}
      />
    </div>
  );
}

function ParamDiffRow({
  row,
  visuals,
  baseKey,
}: {
  row: DiffRow;
  visuals: ReturnType<typeof columnVisuals>;
  baseKey: string;
}) {
  const ref = row.values[baseKey] ?? "";

  return (
    <tr
      className={cn(
        "border-b border-border transition-colors hover:bg-muted/20",
        row.hasDiff && "bg-warm/[0.03]",
      )}
    >
      <td
        className={cn(
          "sticky left-0 z-10 border-r border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground",
          row.hasDiff && "bg-warm/5",
        )}
      >
        <div className="flex items-center gap-2">
          {row.hasDiff ? (
            <span className="h-2 w-2 shrink-0 rounded-full bg-warm" />
          ) : (
            <Equals size={12} className="shrink-0 text-primary" />
          )}
          {row.label}
        </div>
      </td>
      {visuals.map((v, i) => {
        const raw = row.values[v.key] ?? "—";
        const display =
          row.id === "trigger" && raw !== "—" ? (RECALC_TRIGGER[raw]?.label ?? raw) : raw;
        const kind: DiffKind = i === 0 ? "same" : diffKind(ref, raw);
        const delta =
          i > 0 && kind === "changed" && row.deltaUnit
            ? fmtDelta(ref, raw, row.deltaUnit)
            : null;

        return (
          <td
            key={v.key}
            className={cn(
              "px-4 py-2.5 align-top tabular-nums",
              v.isRef && "bg-warm/[0.02]",
              cellBg(kind, row.hasDiff),
            )}
          >
            <DiffCell kind={kind} value={display} delta={delta} />
          </td>
        );
      })}
    </tr>
  );
}

function cellBg(kind: DiffKind, rowHasDiff: boolean): string {
  if (!rowHasDiff) return "";
  switch (kind) {
    case "changed":
      return "bg-warm/10";
    case "added":
      return "bg-emerald-50/80";
    case "missing":
      return "bg-destructive/5";
    default:
      return "";
  }
}

function DiffCell({
  kind,
  value,
  delta,
}: {
  kind: DiffKind;
  value: string;
  delta: string | null;
}) {
  return (
    <div>
      <span
        className={cn(
          "text-sm font-medium",
          kind === "same" && "text-foreground",
          kind === "changed" && "font-semibold text-amber-900",
          kind === "added" && "font-semibold text-emerald-700",
          kind === "missing" && "font-semibold text-destructive",
        )}
      >
        {value}
      </span>
      {delta && <div className="mt-0.5 text-[11px] font-bold text-warm">{delta}</div>}
    </div>
  );
}

function LegendSwatch({ kind, label }: { kind: DiffKind; label: string }) {
  const colors: Record<DiffKind, string> = {
    same: "border-border bg-card",
    changed: "border-amber-300 bg-warm/10",
    added: "border-emerald-300 bg-emerald-50",
    missing: "border-red-200 bg-destructive/10",
  };
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-3 w-3 rounded border", colors[kind])} />
      {label}
    </span>
  );
}
