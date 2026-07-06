"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { getSimulations, type Simulation } from "@/lib/api";
import { cn } from "@/lib/utils";
import { SearchInput } from "@/components/SearchInput";
import { StatusBadge } from "@/components/StatusBadge";
import { SelectedColumnsOrder } from "@/app/comparator/_components/SelectedColumnsOrder";
import { COLUMN_PALETTE } from "@/app/simulator/compare/_components/compare-colors";
import { SkuOverlapPreview } from "./SkuOverlapPreview";
import { MAX_COMPARE_COLUMNS, type ComparisonWizardDraft } from "./wizard-draft";

interface Props {
  draft: ComparisonWizardDraft;
  onChange: (patch: Partial<ComparisonWizardDraft>) => void;
}

export function SimulationsStep({ draft, onChange }: Props) {
  const [query, setQuery] = useState("");
  const { data: simulations, isLoading } = useSWR<Simulation[]>("simulations", () =>
    getSimulations(),
  );

  const columnCount = draft.simulationIds.length + draft.recalculationIds.length;
  const slotsLeft = MAX_COMPARE_COLUMNS - draft.recalculationIds.length;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (simulations ?? []).filter(
      (s) => !q || s.label.toLowerCase().includes(q) || s.project_name?.toLowerCase().includes(q),
    );
  }, [simulations, query]);

  const toggle = (id: string) => {
    const checked = draft.simulationIds.includes(id);
    if (checked) {
      onChange({ simulationIds: draft.simulationIds.filter((x) => x !== id) });
      return;
    }
    if (columnCount >= MAX_COMPARE_COLUMNS) return;
    onChange({ simulationIds: [...draft.simulationIds, id] });
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 lg:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-xl border border-border bg-card">
        <div className="border-b border-border p-4">
          <h2 className="text-lg font-semibold text-foreground">Simulations à comparer</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Sélectionnez entre 2 et {MAX_COMPARE_COLUMNS} colonnes. La première colonne (lettre{" "}
            <span className="font-semibold text-brand-green">A</span>) est la référence pour tous
            les écarts.
          </p>
          <div className="mt-3 flex items-center justify-between gap-3">
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="Rechercher une simulation…"
              className="flex-1"
            />
            <span className="shrink-0 text-xs font-medium text-muted-foreground">
              {columnCount}/{MAX_COMPARE_COLUMNS}
            </span>
          </div>
        </div>

        {draft.simulationIds.length > 0 && (
          <div className="border-b border-border bg-muted/20 p-4">
            <SelectedColumnsOrder
              simulationIds={draft.simulationIds}
              recalculationIds={draft.recalculationIds}
              simulations={simulations ?? []}
              onReorder={(simulationIds) => onChange({ simulationIds })}
              onRemoveSimulation={(id) =>
                onChange({ simulationIds: draft.simulationIds.filter((x) => x !== id) })
              }
            />
          </div>
        )}

        {draft.recalculationIds.length > 0 && draft.simulationIds.length === 0 && (
          <div className="border-b border-border bg-violet-50 px-4 py-2.5 text-xs text-violet-800">
            {draft.recalculationIds.length} snapshot{draft.recalculationIds.length !== 1 ? "s" : ""}{" "}
            de recalcul inclus — ajoutez au moins une simulation de référence.
          </div>
        )}

        {draft.recalculationIds.length > 0 && draft.simulationIds.length > 0 && (
          <div className="border-b border-border bg-violet-50 px-4 py-2 text-xs text-violet-800">
            {slotsLeft} place{slotsLeft !== 1 ? "s" : ""} simulation disponible
            {slotsLeft !== 1 ? "s" : ""} (snapshots recalcul déjà comptés).
          </div>
        )}

        <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
          {isLoading ? (
            <li className="p-6 text-center text-sm text-muted-foreground">Chargement…</li>
          ) : filtered.length === 0 ? (
            <li className="p-6 text-center text-sm text-muted-foreground">
              Aucune simulation trouvée.
            </li>
          ) : (
            filtered.map((sim) => {
              const checked = draft.simulationIds.includes(sim.id);
              const position = draft.simulationIds.indexOf(sim.id);
              const isRef = checked && position === 0;
              const disabled = !checked && columnCount >= MAX_COMPARE_COLUMNS;
              const letter = checked ? String.fromCharCode(65 + position) : null;
              const color = checked ? COLUMN_PALETTE[position % COLUMN_PALETTE.length] : undefined;

              return (
                <li key={sim.id}>
                  <label
                    className={cn(
                      "flex cursor-pointer items-start gap-3 border-l-4 px-4 py-3 transition-colors hover:bg-muted/40",
                      isRef
                        ? "border-brand-green bg-brand-green/5"
                        : checked
                          ? "border-transparent bg-primary/5"
                          : "border-transparent",
                      disabled && "cursor-not-allowed opacity-40",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggle(sim.id)}
                      className="mt-1 h-4 w-4 rounded border-slate-300 accent-primary"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-foreground">{sim.label}</span>
                        <StatusBadge
                          variant={
                            sim.status === "finalized"
                              ? "success"
                              : sim.status === "archived"
                                ? "draft"
                                : "warning"
                          }
                        >
                          {sim.status === "finalized"
                            ? "Finalisé"
                            : sim.status === "archived"
                              ? "Archivé"
                              : "Brouillon"}
                        </StatusBadge>
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>{sim.simulation_type === "tariff" ? "Tarif" : "Projet"}</span>
                        <span>·</span>
                        <span>{sim.line_count} lignes</span>
                        {sim.project_name && (
                          <>
                            <span>·</span>
                            <span className="truncate">{sim.project_name}</span>
                          </>
                        )}
                      </span>
                    </span>
                    {checked && letter && color && (
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <span
                          className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold text-white"
                          style={{ backgroundColor: color }}
                        >
                          {letter}
                        </span>
                        {isRef ? (
                          <span className="text-[10px] font-bold uppercase tracking-wide text-brand-green">
                            Référence
                          </span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">vs réf.</span>
                        )}
                      </span>
                    )}
                  </label>
                </li>
              );
            })
          )}
        </ul>
      </div>

      <div className="w-full shrink-0 lg:w-[380px]">
        <div className="sticky top-4 space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <MagnifyingGlass size={16} />
            Aperçu SKU
          </h3>
          <SkuOverlapPreview simulationIds={draft.simulationIds} simulations={simulations ?? []} />
        </div>
      </div>
    </div>
  );
}
