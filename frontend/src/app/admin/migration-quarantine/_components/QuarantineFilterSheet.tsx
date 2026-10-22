"use client";

import { Faders, X } from "@phosphor-icons/react";
import { useUiTranslate } from "@/lib/use-ui-translate";
import { cn } from "@/lib/utils";
import { AppIcon } from "@/components/AppIcon";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { countActiveQuarantineFilters, type QuarantineFilters } from "./quarantine-filters";
import { QuarantineFiltersSidebar } from "./QuarantineFiltersSidebar";
import type { SavedQuarantineFilter } from "./filters-storage";

interface QuarantineFilterSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: QuarantineFilters;
  onChange: (next: QuarantineFilters) => void;
  onReset: () => void;
  sourceFiles: string[];
  savedFilters: SavedQuarantineFilter[];
  onSaveFilter: (name: string) => void;
  onApplyFilter: (f: SavedQuarantineFilter) => void;
  onDeleteFilter: (id: string) => void;
}

export function QuarantineFilterSheet({
  open,
  onOpenChange,
  filters,
  onChange,
  onReset,
  sourceFiles,
  savedFilters,
  onSaveFilter,
  onApplyFilter,
  onDeleteFilter,
}: QuarantineFilterSheetProps) {
  const t = useUiTranslate();
  const active = countActiveQuarantineFilters(filters);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        showCloseButton={false}
        className="flex w-full max-w-sm flex-col gap-0 p-0"
      >
        <SheetHeader className="border-b border-border bg-gradient-to-r from-card to-primary/5 px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-[var(--shadow-soft)]">
                <AppIcon icon={Faders} weight="duotone" size="md" />
              </span>
              <div>
                <SheetTitle className="text-base">
                  {t("admin.quarantine.filtersQuarantine")}
                </SheetTitle>
                {active > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t(
                      active > 1
                        ? "admin.quarantine.activeCriteriaOther"
                        : "admin.quarantine.activeCriteriaOne",
                      { count: active },
                    )}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1">
              {active > 0 && (
                <Button type="button" variant="ghost" size="sm" onClick={onReset}>
                  {t("admin.quarantine.clear")}
                </Button>
              )}
              <SheetClose
                render={
                  <Button type="button" variant="ghost" size="icon" aria-label={t("common.close")}>
                    <X size={18} />
                  </Button>
                }
              />
            </div>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto overscroll-contain">
          <QuarantineFiltersSidebar
            filters={filters}
            onChange={onChange}
            sourceFiles={sourceFiles}
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
            {t("admin.quarantine.viewResults")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export function QuarantineFilterTrigger({
  activeCount,
  onClick,
}: {
  activeCount: number;
  onClick: () => void;
}) {
  const t = useUiTranslate();
  return (
    <Button
      type="button"
      variant={activeCount > 0 ? "secondary" : "outline"}
      size="sm"
      onClick={onClick}
      className={cn("lg:hidden", activeCount > 0 && "border-primary/30 bg-primary/5 text-primary")}
    >
      <Faders size={16} weight="duotone" />
      {t("admin.quarantine.filters")}
      {activeCount > 0 && (
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
          {activeCount}
        </span>
      )}
    </Button>
  );
}
