"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Equal, Filter } from "lucide-react";
import type { CompareColumn } from "@/lib/api";
import { RECALC_TRIGGER } from "@/app/simulator/[id]/_components/sim-format";
import { cn } from "@/lib/utils";
import {
  buildDiffSections,
  countDiffs,
  diffKind,
  fmtDelta,
  parseNum,
  type DiffKind,
} from "./compare-diff";
import { columnVisuals } from "./compare-colors";

interface Props {
  columns: CompareColumn[];
}

export function CompareContextDiff({ columns }: Props) {
  const sections = useMemo(() => buildDiffSections(columns), [columns]);
  const diffCount = useMemo(() => countDiffs(sections), [sections]);
  const baseKey = columns[0]?.key ?? "";
  const visuals = useMemo(
    () => columnVisuals(columns.map((c) => c.label), columns.map((c) => c.key)),
    [columns]
  );
  const [showAll, setShowAll] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(sections.map((s) => [s.title, true]))
  );

  const toggleSection = (title: string) => {
    setExpanded((prev) => ({ ...prev, [title]: !prev[title] }));
  };

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-gradient-to-r from-slate-50 to-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
          <span className="font-semibold text-slate-700">Légende</span>
          <LegendSwatch kind="same" label="Identique" />
          <LegendSwatch kind="changed" label="Modifié" />
          <LegendSwatch kind="added" label="Ajouté" />
          <LegendSwatch kind="missing" label="Absent" />
        </div>
        <div className="flex items-center gap-3">
          {diffCount > 0 && (
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
              {diffCount} écart{diffCount !== 1 ? "s" : ""}
            </span>
          )}
          <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-600">
            <Filter size={13} />
            <input
              type="checkbox"
              checked={showAll}
              onChange={() => setShowAll((v) => !v)}
              className="h-3.5 w-3.5 rounded accent-primary"
            />
            Afficher tout
          </label>
        </div>
      </div>

      {/* Column legend strip */}
      <div className="flex flex-wrap gap-2">
        {visuals.map((v, i) => (
          <div
            key={v.key}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs",
              v.isRef ? "border-orange-200 bg-orange-50" : "border-slate-200 bg-white"
            )}
          >
            <span
              className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white"
              style={{ backgroundColor: v.color }}
            >
              {String.fromCharCode(65 + i)}
            </span>
            <Link
              href={`/simulator/${columns[i].simulation_id}`}
              className="max-w-[140px] truncate font-medium text-slate-800 hover:text-warm"
              title={v.label}
            >
              {v.shortLabel}
            </Link>
            {v.isRef && (
              <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[9px] font-semibold text-orange-700">
                réf.
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Sections as card grids */}
      {sections.map((section) => {
        const rows = showAll ? section.rows : section.rows.filter((r) => r.hasDiff);
        if (!rows.length) return null;
        const open = expanded[section.title] !== false;
        const sectionDiffs = section.rows.filter((r) => r.hasDiff).length;

        return (
          <section key={section.title} className="rounded-xl border border-border bg-white shadow-sm">
            <button
              type="button"
              onClick={() => toggleSection(section.title)}
              className="flex w-full items-center gap-2 border-b border-border px-4 py-3 text-left transition-colors hover:bg-slate-50"
            >
              {open ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
              <h3 className="text-sm font-semibold text-slate-800">{section.title}</h3>
              {sectionDiffs > 0 && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                  {sectionDiffs}
                </span>
              )}
              <span className="ml-auto text-xs text-slate-400">
                {rows.length} champ{rows.length !== 1 ? "s" : ""}
              </span>
            </button>
            {open && (
              <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
                {rows.map((row) => (
                  <ParamDiffCard
                    key={row.id}
                    label={row.label}
                    values={row.values}
                    hasDiff={row.hasDiff}
                    deltaUnit={row.deltaUnit}
                    fieldId={row.id}
                    columns={columns}
                    visuals={visuals}
                    baseKey={baseKey}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}

      {!showAll && diffCount === 0 && (
        <div className="flex flex-col items-center rounded-xl border border-emerald-200 bg-emerald-50/50 py-12 text-center">
          <Equal size={32} className="mb-2 text-emerald-400" />
          <p className="text-sm font-medium text-emerald-800">Tous les paramètres sont identiques</p>
          <p className="mt-1 text-xs text-emerald-600">Activez « Afficher tout » pour voir le détail complet.</p>
        </div>
      )}
    </div>
  );
}

function ParamDiffCard({
  label,
  values,
  hasDiff,
  deltaUnit,
  fieldId,
  columns,
  visuals,
  baseKey,
}: {
  label: string;
  values: Record<string, string>;
  hasDiff: boolean;
  deltaUnit?: "eur" | "pct" | "raw";
  fieldId: string;
  columns: CompareColumn[];
  visuals: ReturnType<typeof columnVisuals>;
  baseKey: string;
}) {
  const ref = values[baseKey] ?? "";
  const numericVals = columns.map((c) => parseNum(values[c.key] ?? ""));
  const maxNum = Math.max(...numericVals.filter((n): n is number => n != null), 0.001);

  return (
    <div
      className={cn(
        "rounded-lg border p-3 transition-shadow",
        hasDiff ? "border-amber-200 bg-amber-50/30 shadow-sm" : "border-slate-100 bg-slate-50/50"
      )}
    >
      <div className="mb-3 flex items-center gap-2">
        {hasDiff ? (
          <span className="h-2 w-2 rounded-full bg-amber-500" />
        ) : (
          <Equal size={12} className="text-emerald-500" />
        )}
        <span className="text-xs font-semibold text-slate-700">{label}</span>
      </div>
      <div className="space-y-2">
        {visuals.map((v, i) => {
          const raw = values[v.key] ?? "—";
          const display =
            fieldId === "trigger" && raw !== "—"
              ? (RECALC_TRIGGER[raw]?.label ?? raw)
              : raw;
          const kind = i === 0 ? "same" : diffKind(ref, raw);
          const delta = i > 0 && kind === "changed" && deltaUnit ? fmtDelta(ref, raw, deltaUnit) : null;
          const num = parseNum(raw);
          const barPct = num != null && maxNum > 0 ? (num / maxNum) * 100 : 0;

          return (
            <div key={v.key} className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[10px] font-semibold" style={{ color: v.color }}>
                  <span
                    className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-bold text-white"
                    style={{ backgroundColor: v.color }}
                  >
                    {String.fromCharCode(65 + i)}
                  </span>
                  {v.isRef ? "Réf." : v.shortLabel}
                </span>
                <DiffValue kind={kind} value={display} delta={delta} />
              </div>
              {num != null && num > 0 && (
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-200/80">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.max(barPct, 4)}%`,
                      backgroundColor: kind === "changed" ? "#F59E0B" : v.color,
                      opacity: kind === "same" ? 0.5 : 0.9,
                    }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DiffValue({
  kind,
  value,
  delta,
}: {
  kind: DiffKind;
  value: string;
  delta: string | null;
}) {
  return (
    <div className="text-right">
      <span
        className={cn(
          "text-xs font-semibold tabular-nums",
          kind === "same" && "text-slate-500",
          kind === "changed" && "text-amber-900",
          kind === "added" && "text-emerald-700",
          kind === "missing" && "text-red-600"
        )}
      >
        {value}
      </span>
      {delta && <div className="text-[10px] font-bold text-amber-600">{delta}</div>}
    </div>
  );
}

function LegendSwatch({ kind, label }: { kind: DiffKind; label: string }) {
  const colors: Record<DiffKind, string> = {
    same: "border-slate-200 bg-white",
    changed: "border-amber-300 bg-amber-50",
    added: "border-emerald-300 bg-emerald-50",
    missing: "border-red-200 bg-red-50",
  };
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-3 w-3 rounded border", colors[kind])} />
      {label}
    </span>
  );
}
