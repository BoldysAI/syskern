"use client";

import { Faders, X } from "@phosphor-icons/react";
import type { SimulationFilters } from "@/lib/api";
import { cn } from "@/lib/utils";
import { AppIcon } from "@/components/AppIcon";
import { Button } from "@/components/ui/button";
import { countActiveSimulationFilters } from "./simulation-filters";
import { SimulationFiltersSidebar } from "./SimulationFiltersSidebar";
import type { SavedSimulationFilter } from "./filters-storage";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

interface SimulationFilterSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: SimulationFilters;
  onChange: (next: SimulationFilters) => void;
  onReset: () => void;
  savedFilters: SavedSimulationFilter[];
  onSaveFilter: (name: string) => void;
  onApplyFilter: (f: SavedSimulationFilter) => void;
  onDeleteFilter: (id: string) => void;
}

export function SimulationFilterSheet({
  open,
  onOpenChange,
  filters,
  onChange,
  onReset,
  savedFilters,
  onSaveFilter,
  onApplyFilter,
  onDeleteFilter,
}: SimulationFilterSheetProps) {
  const active = countActiveSimulationFilters(filters);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" showCloseButton={false} className="flex w-full max-w-sm flex-col gap-0 p-0">
        <SheetHeader className="border-b border-border bg-gradient-to-r from-card to-primary/5 px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-[var(--shadow-soft)]">
                <AppIcon icon={Faders} weight="duotone" size="md" />
              </span>
              <div>
                <SheetTitle className="text-base">Filtres simulations</SheetTitle>
                {active > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {active} critère{active > 1 ? "s" : ""} actif{active > 1 ? "s" : ""}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1">
              {active > 0 && (
                <Button type="button" variant="ghost" size="sm" onClick={onReset}>
                  Effacer
                </Button>
              )}
              <SheetClose
                render={
                  <Button type="button" variant="ghost" size="icon" aria-label="Fermer">
                    <X size={18} />
                  </Button>
                }
              />
            </div>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto overscroll-contain">
          <SimulationFiltersSidebar
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

        <SheetFooter className="border-t border-border bg-muted/30 p-4">
          <Button type="button" className="w-full" onClick={() => onOpenChange(false)}>
            Voir les résultats
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export function SimulationFilterTrigger({
  activeCount,
  onClick,
}: {
  activeCount: number;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant={activeCount > 0 ? "secondary" : "outline"}
      size="sm"
      onClick={onClick}
      className={cn("lg:hidden", activeCount > 0 && "border-primary/30 bg-primary/5 text-primary")}
    >
      <Faders size={16} weight="duotone" />
      Filtres
      {activeCount > 0 && (
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
          {activeCount}
        </span>
      )}
    </Button>
  );
}
