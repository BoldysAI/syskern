"use client";

import { Package, X } from "@phosphor-icons/react";
import type { SelectedSku } from "./wizard-draft";

interface Props {
  skus: SelectedSku[];
  onRemove: (id: string) => void;
  onClear: () => void;
}

/** Cumulative list of SKU selected across the 3 methods (CDC §6.9.2). */
export function SelectedSkuList({ skus, onRemove, onClear }: Props) {
  return (
    <div className="border border-border rounded-xl bg-card shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
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
          Aucun SKU sélectionné. Utilisez les méthodes ci-dessus pour en ajouter.
        </p>
      ) : (
        <ul className="max-h-56 overflow-y-auto divide-y divide-[#F1F5F9]">
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
