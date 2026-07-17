"use client";

import { cn } from "@/lib/utils";
import type { SimulationType } from "@/lib/api";
import { Package, X } from "@phosphor-icons/react";
import type { SelectedSku } from "./wizard-draft";

interface Props {
  skus: SelectedSku[];
  simulationType: SimulationType;
  onChange: (skus: SelectedSku[]) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  className?: string;
}

const inputCls =
  "w-full min-w-0 rounded border border-border px-2 py-1 text-right text-sm font-medium text-foreground font-data tabular-nums focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30";

function patchSku(skus: SelectedSku[], id: string, patch: Partial<SelectedSku>): SelectedSku[] {
  return skus.map((s) => (s.id === id ? { ...s, ...patch } : s));
}

/** Cumulative list of SKU selected across the 3 methods (CDC §6.9.2). */
export function SelectedSkuList({
  skus,
  simulationType,
  onChange,
  onRemove,
  onClear,
  className,
}: Props) {
  const isProject = simulationType === "project";

  return (
    <div className={cn("flex flex-col rounded-xl border border-border bg-card shadow-sm", className)}>
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Package size={16} className="text-warm" />
          <span className="text-sm font-semibold text-foreground">
            {skus.length} SKU sélectionné{skus.length !== 1 ? "s" : ""}
          </span>
        </div>
        {skus.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="text-xs font-semibold text-muted-foreground hover:text-destructive"
          >
            Tout retirer
          </button>
        )}
      </div>

      {skus.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          Aucun SKU sélectionné. Parcourez le catalogue pour en ajouter.
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div
            className={cn(
              "sticky top-0 z-10 grid gap-2 border-b border-border bg-muted/40 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground",
              isProject ? "grid-cols-[minmax(0,1fr)_4.5rem_2rem]" : "grid-cols-[minmax(0,1fr)_2rem]",
            )}
          >
            <span>SKU</span>
            {isProject && <span className="text-right">Qté</span>}
            <span />
          </div>
          <ul className="divide-y divide-border">
            {skus.map((s) => (
              <li
                key={s.id}
                className={cn(
                  "grid items-center gap-2 px-3 py-2 hover:bg-muted",
                  isProject ? "grid-cols-[minmax(0,1fr)_4.5rem_2rem]" : "grid-cols-[minmax(0,1fr)_2rem]",
                )}
              >
                <div className="min-w-0">
                  <div className="truncate font-mono text-sm font-semibold text-foreground">
                    {s.sku_code}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{s.name}</div>
                </div>
                {isProject && (
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={s.quantity ?? ""}
                    onChange={(e) => {
                      const next = e.target.value.replace(/[^\d]/g, "");
                      onChange(patchSku(skus, s.id, { quantity: next }));
                    }}
                    placeholder="1"
                    className={inputCls}
                    aria-label={`Quantité pour ${s.sku_code}`}
                  />
                )}
                <button
                  type="button"
                  onClick={() => onRemove(s.id)}
                  className="justify-self-end rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-red-500"
                  aria-label={`Retirer ${s.sku_code}`}
                >
                  <X size={15} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
