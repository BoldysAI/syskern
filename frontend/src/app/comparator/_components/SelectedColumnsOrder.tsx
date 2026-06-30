"use client";

import {
  ArrowDown,
  ArrowUp,
  Star,
  X,
} from "@phosphor-icons/react";
import type { Simulation } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { COLUMN_PALETTE } from "@/app/simulator/compare/_components/compare-colors";

interface Props {
  simulationIds: string[];
  recalculationIds?: string[];
  simulations: Simulation[];
  onReorder?: (simulationIds: string[]) => void;
  onRemoveSimulation?: (id: string) => void;
  readOnly?: boolean;
  className?: string;
}

export function SelectedColumnsOrder({
  simulationIds,
  recalculationIds = [],
  simulations,
  onReorder,
  onRemoveSimulation,
  readOnly = false,
  className,
}: Props) {
  const simMap = new Map(simulations.map((s) => [s.id, s]));
  const totalColumns = simulationIds.length + recalculationIds.length;

  if (totalColumns === 0) return null;

  const move = (id: string, direction: -1 | 1) => {
    if (!onReorder) return;
    const ids = [...simulationIds];
    const idx = ids.indexOf(id);
    const target = idx + direction;
    if (idx < 0 || target < 0 || target >= ids.length) return;
    [ids[idx], ids[target]] = [ids[target], ids[idx]];
    onReorder(ids);
  };

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Ordre des colonnes
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            La colonne <span className="font-semibold text-warm">A · Référence</span> sert de base
            pour les écarts (PV, paramètres, etc.).
          </p>
        </div>
        {!readOnly && simulationIds.length > 1 && (
          <p className="hidden shrink-0 text-xs text-muted-foreground sm:block">
            Flèches ↑↓ pour changer la référence
          </p>
        )}
      </div>

      <ol className="space-y-2">
        {simulationIds.map((id, i) => {
          const sim = simMap.get(id);
          const isRef = i === 0;
          const letter = String.fromCharCode(65 + i);
          const color = COLUMN_PALETTE[i % COLUMN_PALETTE.length];

          return (
            <li
              key={id}
              className={cn(
                "flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors",
                isRef
                  ? "border-warm/40 bg-gradient-to-r from-warm/10 to-white ring-1 ring-warm/25"
                  : "border-border bg-card",
              )}
            >
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                style={{ backgroundColor: color }}
              >
                {letter}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-semibold text-foreground">
                    {sim?.label ?? "Simulation"}
                  </span>
                  {isRef && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-warm px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                      <Star size={10} weight="fill" />
                      Référence
                    </span>
                  )}
                  {!isRef && (
                    <span className="text-[10px] font-medium text-muted-foreground">
                      vs réf.
                    </span>
                  )}
                </div>
                {sim && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {sim.simulation_type === "tariff" ? "Tarif" : "Projet"} · {sim.line_count} lignes
                  </p>
                )}
              </div>

              {!readOnly && (
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={i === 0}
                    onClick={() => move(id, -1)}
                    title="Monter (devient référence si en 1ʳᵉ position)"
                    aria-label="Monter"
                  >
                    <ArrowUp size={14} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={i === simulationIds.length - 1}
                    onClick={() => move(id, 1)}
                    title="Descendre"
                    aria-label="Descendre"
                  >
                    <ArrowDown size={14} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => onRemoveSimulation?.(id)}
                    title="Retirer"
                    aria-label="Retirer"
                  >
                    <X size={14} />
                  </Button>
                </div>
              )}
            </li>
          );
        })}

        {recalculationIds.map((id, i) => {
          const colIndex = simulationIds.length + i;
          const letter = String.fromCharCode(65 + colIndex);
          return (
            <li
              key={`recalc-${id}`}
              className="flex items-center gap-3 rounded-xl border border-violet-200 bg-violet-50/80 px-3 py-2.5"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-600 text-xs font-bold text-white">
                {letter}
              </span>
              <div className="min-w-0 flex-1">
                <span className="text-sm font-medium text-violet-900">Snapshot de recalcul</span>
                <p className="mt-0.5 text-xs text-violet-700">Colonne historique figée</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
