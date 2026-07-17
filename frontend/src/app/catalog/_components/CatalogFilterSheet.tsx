"use client";

import type { ReactNode } from "react";
import { Faders, X } from "@phosphor-icons/react";
import type { CatalogFilters } from "@/lib/api";
import { cn } from "@/lib/utils";
import { AppIcon } from "@/components/AppIcon";
import { Button } from "@/components/ui/button";
import { countActiveFilters } from "./active-filters";
import { CatalogSidebar } from "./CatalogSidebar";
import type { SavedFilter } from "./filters-storage";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

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
  /** Optional blocks rendered above the catalogue filter sections (e.g. simulation status). */
  prependContent?: ReactNode;
  title?: string;
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
  prependContent,
  title = "Filtres catalogue",
}: CatalogFilterSheetProps) {
  const active = countActiveFilters(filters);

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
                <SheetTitle className="text-base">{title}</SheetTitle>
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
          {prependContent}
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

        <SheetFooter className="border-t border-border bg-muted/30 p-4">
          <Button type="button" className="w-full" onClick={() => onOpenChange(false)}>
            Voir les résultats
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
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
