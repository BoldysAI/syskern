"use client";

import { cn } from "@/lib/utils";
import { Package, X } from "@phosphor-icons/react";
import type { SelectedSku } from "./wizard-draft";

interface Props {
  skus: SelectedSku[];
  onRemove: (id: string) => void;
  onClear: () => void;
  className?: string;
}

/** Cumulative list of SKU selected across the 3 methods (CDC §6.9.2). */
export function SelectedSkuList({ skus, onRemove, onClear, className }: Props) {
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
        <ul className="min-h-0 flex-1 divide-y divide-[#F1F5F9] overflow-y-auto">
          {skus.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-3 px-4 py-2 hover:bg-muted"
            >
              <span className="font-mono text-sm font-semibold text-foreground w-44 truncate">
                {s.sku_code}
              </span>
              <span className="text-sm text-muted-foreground truncate flex-1">{s.name}</span>
              <button
                type="button"
                onClick={() => onRemove(s.id)}
                className="p-1 text-muted-foreground hover:text-red-500 hover:bg-destructive/10 rounded"
                aria-label={`Retirer ${s.sku_code}`}
              >
                <X size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
