"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { SlidersHorizontal, X } from "lucide-react";
import type { CatalogFilters } from "@/lib/api";
import { cn } from "@/lib/utils";
import { countActiveFilters } from "./active-filters";
import { CatalogSidebar } from "./CatalogSidebar";
import type { SavedFilter } from "./filters-storage";

interface CatalogFilterSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: CatalogFilters;
  onChange: (next: CatalogFilters) => void;
  onReset: () => void;
  savedFilters: SavedFilter[];
  onSaveFilter: (name: string) => void;
  onApplyFilter: (f: SavedFilter) => void;
  onDeleteFilter: (id: string) => void;
}

export function CatalogFilterSheet({
  open,
  onOpenChange,
  filters,
  onChange,
  onReset,
  savedFilters,
  onSaveFilter,
  onApplyFilter,
  onDeleteFilter,
}: CatalogFilterSheetProps) {
  const active = countActiveFilters(filters);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-navy-900/40 backdrop-blur-[2px] data-[state=open]:animate-in" />
        <Dialog.Content
          className={cn(
            "fixed inset-y-0 left-0 z-50 flex w-full max-w-sm flex-col bg-white shadow-2xl",
            "focus:outline-none data-[state=open]:animate-in"
          )}
        >
          <div className="flex items-center justify-between gap-3 px-4 py-4 border-b border-slate-200 bg-gradient-to-r from-white to-orange-50/40">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-500 text-white shadow-sm">
                <SlidersHorizontal size={18} />
              </span>
              <div>
                <Dialog.Title className="text-base font-semibold text-slate-900">
                  Filtres catalogue
                </Dialog.Title>
                {active > 0 && (
                  <p className="text-xs text-slate-500">{active} critère{active > 1 ? "s" : ""} actif{active > 1 ? "s" : ""}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1">
              {active > 0 && (
                <button
                  type="button"
                  onClick={onReset}
                  className="text-xs font-semibold text-orange-600 hover:text-orange-700 px-2 py-1 rounded-md"
                >
                  Effacer
                </button>
              )}
              <Dialog.Close
                className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                aria-label="Fermer"
              >
                <X size={20} />
              </Dialog.Close>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto overscroll-contain">
            <CatalogSidebar
              filters={filters}
              onChange={onChange}
              savedFilters={savedFilters}
              onSaveFilter={onSaveFilter}
              onApplyFilter={(sf) => {
                onApplyFilter(sf);
                onOpenChange(false);
              }}
              onDeleteFilter={onDeleteFilter}
            />
          </div>

          <div className="p-4 border-t border-slate-200 bg-slate-50">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="w-full py-2.5 text-sm font-semibold text-white bg-orange-500 rounded-lg hover:bg-orange-600 transition-colors shadow-sm"
            >
              Voir les résultats
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Trigger button for mobile / tablet filter sheet. */
export function CatalogFilterTrigger({
  activeCount,
  onClick,
}: {
  activeCount: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "lg:hidden inline-flex items-center gap-2 h-9 px-3 text-sm font-medium rounded-lg border transition-colors",
        activeCount > 0
          ? "border-orange-300 bg-orange-50 text-orange-800"
          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
      )}
    >
      <SlidersHorizontal size={16} />
      Filtres
      {activeCount > 0 && (
        <span className="min-w-[1.25rem] h-5 px-1 rounded-full bg-orange-500 text-white text-[10px] font-bold flex items-center justify-center">
          {activeCount}
        </span>
      )}
    </button>
  );
}
