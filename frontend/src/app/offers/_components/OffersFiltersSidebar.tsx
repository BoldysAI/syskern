"use client";

import { useState } from "react";
import {
  Bookmark,
  BookmarkSimple,
  FileText,
  Faders,
  SealCheck,
  Sparkle,
  Trash,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { FilterSection } from "@/components/FilterSection";
import { FilterCheckboxGroup } from "@/components/FilterCheckboxGroup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  isEmptyOfferFilter,
  OFFER_GENERATION_OPTIONS,
  OFFER_STATUS_OPTIONS,
  OFFER_TYPE_OPTIONS,
  type OfferFilters,
  type OfferGeneration,
  type OfferStatus,
  type OfferType,
} from "./offer-filters";
import type { SavedOfferFilter } from "./filters-storage";

interface OffersFiltersSidebarProps {
  filters: OfferFilters;
  onChange: (next: OfferFilters) => void;
  savedFilters: SavedOfferFilter[];
  onSaveFilter: (name: string) => void;
  onApplyFilter: (f: SavedOfferFilter) => void;
  onDeleteFilter: (id: string) => void;
  className?: string;
}

export function OffersFiltersSidebar({
  filters,
  onChange,
  savedFilters,
  onSaveFilter,
  onApplyFilter,
  onDeleteFilter,
  className,
}: OffersFiltersSidebarProps) {
  const patch = (p: Partial<OfferFilters>) => onChange({ ...filters, ...p });

  const [saveName, setSaveName] = useState("");
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);

  const handleSave = () => {
    const name = saveName.trim();
    if (!name || isEmptyOfferFilter(filters)) return;
    onSaveFilter(name);
    setSaveName("");
    setSaveFeedback(`Filtre « ${name} » enregistré.`);
    window.setTimeout(() => setSaveFeedback(null), 4000);
  };

  const canSave = saveName.trim().length > 0 && !isEmptyOfferFilter(filters);

  return (
    <div className={cn("flex flex-col gap-1 p-4", className)}>
      <FilterSection title="Type" icon={FileText} activeCount={filters.offer_type?.length ?? 0}>
        <FilterCheckboxGroup
          idPrefix="offer-type"
          options={OFFER_TYPE_OPTIONS}
          selected={filters.offer_type ?? []}
          onChange={(v) => patch({ offer_type: v.length ? (v as OfferType[]) : undefined })}
        />
      </FilterSection>

      <FilterSection title="Statut" icon={SealCheck} activeCount={filters.status?.length ?? 0}>
        <FilterCheckboxGroup
          idPrefix="offer-status"
          options={OFFER_STATUS_OPTIONS}
          selected={filters.status ?? []}
          onChange={(v) => patch({ status: v.length ? (v as OfferStatus[]) : undefined })}
        />
      </FilterSection>

      <FilterSection
        title="Document"
        icon={Sparkle}
        activeCount={filters.generation_status?.length ?? 0}
      >
        <FilterCheckboxGroup
          idPrefix="offer-generation"
          options={OFFER_GENERATION_OPTIONS}
          selected={filters.generation_status ?? []}
          onChange={(v) =>
            patch({ generation_status: v.length ? (v as OfferGeneration[]) : undefined })
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
