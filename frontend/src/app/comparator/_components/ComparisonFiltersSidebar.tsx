"use client";

import { useState } from "react";
import { Bookmark, BookmarkSimple, Calculator, Faders, Stack, Trash } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { FilterSection } from "@/components/FilterSection";
import { FilterCheckboxGroup } from "@/components/FilterCheckboxGroup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  isEmptyComparisonFilter,
  SIM_TYPE_OPTIONS,
  STRUCTURE_OPTIONS,
  type ComparisonFilters,
  type ComparisonSimType,
  type HasRecalcFilter,
} from "./comparison-filters";
import type { SavedComparisonFilter } from "./filters-storage";

interface ComparisonFiltersSidebarProps {
  filters: ComparisonFilters;
  onChange: (next: ComparisonFilters) => void;
  savedFilters: SavedComparisonFilter[];
  onSaveFilter: (name: string) => void;
  onApplyFilter: (f: SavedComparisonFilter) => void;
  onDeleteFilter: (id: string) => void;
  className?: string;
}

export function ComparisonFiltersSidebar({
  filters,
  onChange,
  savedFilters,
  onSaveFilter,
  onApplyFilter,
  onDeleteFilter,
  className,
}: ComparisonFiltersSidebarProps) {
  const patch = (p: Partial<ComparisonFilters>) => onChange({ ...filters, ...p });

  const [saveName, setSaveName] = useState("");
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);

  const handleSave = () => {
    const name = saveName.trim();
    if (!name || isEmptyComparisonFilter(filters)) return;
    onSaveFilter(name);
    setSaveName("");
    setSaveFeedback(`Filtre « ${name} » enregistré.`);
    window.setTimeout(() => setSaveFeedback(null), 4000);
  };

  const canSave = saveName.trim().length > 0 && !isEmptyComparisonFilter(filters);

  return (
    <div className={cn("flex flex-col gap-1 p-4", className)}>
      <FilterSection
        title="Type de comparaison"
        icon={Stack}
        activeCount={filters.has_recalculations ? 1 : 0}
      >
        <FilterCheckboxGroup
          idPrefix="cmp-structure"
          options={STRUCTURE_OPTIONS}
          selected={filters.has_recalculations ? [filters.has_recalculations] : []}
          // Single-select via checkboxes: last toggled wins, unchecking clears.
          onChange={(v) =>
            patch({
              has_recalculations: v.length ? (v[v.length - 1] as HasRecalcFilter) : undefined,
            })
          }
        />
      </FilterSection>

      <FilterSection
        title="Simulations comparées"
        icon={Calculator}
        activeCount={filters.sim_type?.length ?? 0}
      >
        <FilterCheckboxGroup
          idPrefix="cmp-simtype"
          options={SIM_TYPE_OPTIONS}
          selected={filters.sim_type ?? []}
          onChange={(v) => patch({ sim_type: v.length ? (v as ComparisonSimType[]) : undefined })}
        />
      </FilterSection>

      <FilterSection title="Filtres enregistrés" icon={Bookmark}>
        {savedFilters.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Enregistrez une combinaison de filtres pour la réutiliser rapidement.
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
                  onClick={() => onApplyFilter(sf)}
                  className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left text-sm hover:bg-muted/50"
                >
                  <BookmarkSimple size={14} className="shrink-0 text-primary" />
                  <span className="truncate font-medium">{sf.name}</span>
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onDeleteFilter(sf.id)}
                  aria-label={`Supprimer ${sf.name}`}
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
            placeholder="Nom du filtre…"
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
            Enregistrer les filtres actifs
          </Button>
          {saveFeedback && <p className="text-center text-xs text-brand-green">{saveFeedback}</p>}
        </div>
      </FilterSection>
    </div>
  );
}
