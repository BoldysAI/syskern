"use client";

import { useState } from "react";
import {
  Bookmark,
  BookmarkSimple,
  FileText,
  Faders,
  SealCheck,
  Warning,
  Trash,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { FilterSection } from "@/components/FilterSection";
import { FilterCheckboxGroup } from "@/components/FilterCheckboxGroup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  isEmptyQuarantineFilter,
  REASON_OPTIONS,
  RESOLVED_OPTIONS,
  type QuarantineFilters,
  type ResolvedFilter,
} from "./quarantine-filters";
import type { SavedQuarantineFilter } from "./filters-storage";

interface QuarantineFiltersSidebarProps {
  filters: QuarantineFilters;
  onChange: (next: QuarantineFilters) => void;
  /** Distinct source files from the facets endpoint (dynamic options). */
  sourceFiles: string[];
  savedFilters: SavedQuarantineFilter[];
  onSaveFilter: (name: string) => void;
  onApplyFilter: (f: SavedQuarantineFilter) => void;
  onDeleteFilter: (id: string) => void;
  className?: string;
}

export function QuarantineFiltersSidebar({
  filters,
  onChange,
  sourceFiles,
  savedFilters,
  onSaveFilter,
  onApplyFilter,
  onDeleteFilter,
  className,
}: QuarantineFiltersSidebarProps) {
  const patch = (p: Partial<QuarantineFilters>) => onChange({ ...filters, ...p });

  const [saveName, setSaveName] = useState("");
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);

  const handleSave = () => {
    const name = saveName.trim();
    if (!name || isEmptyQuarantineFilter(filters)) return;
    onSaveFilter(name);
    setSaveName("");
    setSaveFeedback(`Filtre « ${name} » enregistré.`);
    window.setTimeout(() => setSaveFeedback(null), 4000);
  };

  const canSave = saveName.trim().length > 0 && !isEmptyQuarantineFilter(filters);

  const sourceOptions = sourceFiles.map((f) => ({ value: f, label: f }));

  return (
    <div className={cn("flex flex-col gap-1 p-4", className)}>
      <FilterSection
        title="Fichier source"
        icon={FileText}
        activeCount={filters.source_file?.length ?? 0}
      >
        <FilterCheckboxGroup
          idPrefix="quar-source"
          options={sourceOptions}
          selected={filters.source_file ?? []}
          onChange={(v) => patch({ source_file: v.length ? v : undefined })}
          searchable
          searchPlaceholder="Filtrer les fichiers…"
        />
      </FilterSection>

      <FilterSection title="Motif" icon={Warning} activeCount={filters.reason?.length ?? 0}>
        <FilterCheckboxGroup
          idPrefix="quar-reason"
          options={REASON_OPTIONS}
          selected={filters.reason ?? []}
          onChange={(v) => patch({ reason: v.length ? v : undefined })}
        />
      </FilterSection>

      <FilterSection title="Statut" icon={SealCheck} activeCount={filters.resolved ? 1 : 0}>
        <FilterCheckboxGroup
          idPrefix="quar-resolved"
          options={RESOLVED_OPTIONS}
          selected={filters.resolved ? [filters.resolved] : []}
          // Single-select semantics via checkboxes: the last toggled wins,
          // unchecking clears the filter (no value → all rows).
          onChange={(v) =>
            patch({ resolved: v.length ? (v[v.length - 1] as ResolvedFilter) : undefined })
          }
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
