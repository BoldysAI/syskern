"use client";

import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useUiTranslate } from "@/lib/use-ui-translate";
import {
  Bookmark,
  BookmarkSimple,
  Calculator,
  Clock,
  Faders,
  SealCheck,
  Trash,
} from "@phosphor-icons/react";
import type { SimulationFilters, SimulationStatus, SimulationType } from "@/lib/api";
import { cn } from "@/lib/utils";
import { FilterSection } from "@/components/FilterSection";
import { FilterCheckboxGroup } from "@/components/FilterCheckboxGroup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  isEmptySimulationFilter,
  simulationStatusOptions,
  simulationTypeOptions,
} from "./simulation-filters";
import type { SavedSimulationFilter } from "./filters-storage";

interface SimulationFiltersSidebarProps {
  filters: SimulationFilters;
  onChange: (next: SimulationFilters) => void;
  savedFilters?: SavedSimulationFilter[];
  onSaveFilter?: (name: string) => void;
  onApplyFilter?: (f: SavedSimulationFilter) => void;
  onDeleteFilter?: (id: string) => void;
  /** Hide sections when embedded in a scoped context (e.g. the offer picker). */
  hideStatus?: boolean;
  hideDirty?: boolean;
  hideSaved?: boolean;
  className?: string;
}

export function SimulationFiltersSidebar({
  filters,
  onChange,
  savedFilters = [],
  onSaveFilter,
  onApplyFilter,
  onDeleteFilter,
  hideStatus = false,
  hideDirty = false,
  hideSaved = false,
  className,
}: SimulationFiltersSidebarProps) {
  const t = useUiTranslate();
  const { displayLanguage } = useAuth();
  const patch = (p: Partial<SimulationFilters>) => onChange({ ...filters, ...p });

  const [saveName, setSaveName] = useState("");
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);

  const handleSave = () => {
    const name = saveName.trim();
    if (!name || isEmptySimulationFilter(filters)) return;
    onSaveFilter?.(name);
    setSaveName("");
    setSaveFeedback(t("simulator.filters.savedFeedback", { name }));
    window.setTimeout(() => setSaveFeedback(null), 4000);
  };

  const canSave = saveName.trim().length > 0 && !isEmptySimulationFilter(filters);

  return (
    <div className={cn("flex flex-col gap-1 p-4", className)}>
      <FilterSection title={t("simulator.filters.type")} icon={Calculator}>
        <FilterCheckboxGroup
          options={simulationTypeOptions(displayLanguage)}
          selected={filters.simulation_type ?? []}
          onChange={(simulation_type) =>
            patch({
              simulation_type: simulation_type.length
                ? (simulation_type as SimulationType[])
                : undefined,
            })
          }
        />
      </FilterSection>

      {!hideStatus && (
        <FilterSection title={t("simulator.filters.status")} icon={SealCheck}>
          <FilterCheckboxGroup
            options={simulationStatusOptions(displayLanguage)}
            selected={filters.status ?? []}
            onChange={(status) =>
              patch({
                status: status.length ? (status as SimulationStatus[]) : undefined,
              })
            }
          />
        </FilterSection>
      )}

      {!hideDirty && (
        <FilterSection title={t("simulator.filters.calcState")} icon={Clock}>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2.5">
            <Label htmlFor="filter-dirty-only" className="text-sm font-normal text-foreground">
              {t("simulator.status.dirty")}
            </Label>
            <Switch
              id="filter-dirty-only"
              checked={filters.is_dirty === true}
              onCheckedChange={(checked) =>
                patch({ is_dirty: checked === true ? true : undefined })
              }
            />
          </div>
        </FilterSection>
      )}

      {!hideSaved && (
        <FilterSection title={t("simulator.filters.saved")} icon={Bookmark}>
          {savedFilters.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t("simulator.filters.savedEmpty")}
            </p>
          ) : (
            <ul className="space-y-1">
              {savedFilters.map((sf) => (
                <li
                  key={sf.id}
                  className="flex items-center gap-1 rounded-lg border border-border bg-card pr-1 shadow-[var(--shadow-soft)]"
                >
                  <button
                    type="button"
                    onClick={() => onApplyFilter?.(sf)}
                    className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left text-sm hover:bg-muted/50"
                  >
                    <BookmarkSimple size={14} className="shrink-0 text-primary" />
                    <span className="truncate font-medium">{sf.name}</span>
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => onDeleteFilter?.(sf.id)}
                    aria-label={t("simulator.filters.deleteSaved", { name: sf.name })}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash size={14} />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3 space-y-2">
            <Input
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder={t("simulator.filters.namePlaceholder")}
              className="h-9 text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSave) handleSave();
              }}
            />
            <Button
              type="button"
              size="sm"
              className="w-full"
              disabled={!canSave}
              onClick={handleSave}
            >
              <Faders size={14} />
              {t("simulator.filters.saveActive")}
            </Button>
            {saveFeedback && <p className="text-center text-xs text-brand-green">{saveFeedback}</p>}
          </div>
        </FilterSection>
      )}
    </div>
  );
}
