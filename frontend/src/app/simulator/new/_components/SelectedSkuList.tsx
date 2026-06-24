"use client";

import { Package, X } from "lucide-react";
import type { SelectedSku } from "./wizard-draft";

interface Props {
  skus: SelectedSku[];
  onRemove: (id: string) => void;
  onClear: () => void;
}

/** Cumulative list of SKU selected across the 3 methods (CDC §6.9.2). */
export function SelectedSkuList({ skus, onRemove, onClear }: Props) {
  return (
    <div className="border border-border rounded-xl bg-white shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Package size={16} className="text-warm" />
          <span className="text-sm font-semibold text-slate-800">
            {skus.length} SKU sélectionné{skus.length !== 1 ? "s" : ""}
          </span>
        </div>
        {skus.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="text-xs font-semibold text-slate-500 hover:text-red-600"
          >
            Tout retirer
          </button>
        )}
      </div>

      {skus.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-slate-400">
          Aucun SKU sélectionné. Utilisez les méthodes ci-dessus pour en ajouter.
        </p>
      ) : (
        <ul className="max-h-56 overflow-y-auto divide-y divide-[#F1F5F9]">
          {skus.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-3 px-4 py-2 hover:bg-slate-50"
            >
              <span className="font-mono text-sm font-semibold text-slate-800 w-44 truncate">
                {s.sku_code}
              </span>
              <span className="text-sm text-slate-600 truncate flex-1">{s.name}</span>
              <button
                type="button"
                onClick={() => onRemove(s.id)}
                className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded"
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
