"use client";

import { X } from "lucide-react";
import type { CatalogFilters } from "@/lib/api";
import { buildFilterChips, countActiveFilters, removeFilterChip } from "./active-filters";

interface ActiveFilterBarProps {
  filters: CatalogFilters;
  attrLabels?: Record<string, string>;
  onChange: (next: CatalogFilters) => void;
  onClearAll: () => void;
}

export function ActiveFilterBar({
  filters,
  attrLabels = {},
  onChange,
  onClearAll,
}: ActiveFilterBarProps) {
  const chips = buildFilterChips(filters, attrLabels);
  const total = countActiveFilters(filters);

  if (total === 0) return null;

  return (
    <div className="flex-shrink-0 px-4 py-3 bg-orange-50/60 border-b border-orange-100/80">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide mr-1">
          Filtres actifs
          <span className="ml-1.5 inline-flex min-w-[1.25rem] h-5 px-1.5 items-center justify-center rounded-full bg-orange-500 text-white text-[10px] font-bold tabular-nums">
            {total}
          </span>
        </span>
        {chips.map((chip) => (
          <button
            key={chip.id}
            type="button"
            onClick={() => onChange(removeFilterChip(filters, chip.id))}
            className="group inline-flex items-center gap-1.5 max-w-[220px] pl-2.5 pr-1.5 py-1 rounded-full text-xs font-medium bg-white border border-orange-200/80 text-slate-700 shadow-sm hover:border-orange-300 hover:bg-orange-50 transition-colors"
            title={`Retirer : ${chip.category} — ${chip.label}`}
          >
            <span className="text-[10px] font-semibold uppercase tracking-wide text-orange-600/90 shrink-0">
              {chip.category}
            </span>
            <span className="truncate">{chip.label}</span>
            <X
              size={12}
              className="shrink-0 text-slate-400 group-hover:text-red-500 transition-colors"
            />
          </button>
        ))}
        <button
          type="button"
          onClick={onClearAll}
          className="ml-auto text-xs font-semibold text-orange-600 hover:text-orange-700 px-2 py-1 rounded-md hover:bg-orange-100/80 transition-colors"
        >
          Tout effacer
        </button>
      </div>
    </div>
  );
}
