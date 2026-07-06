"use client";

import { X } from "@phosphor-icons/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  buildComparisonFilterChips,
  countActiveComparisonFilters,
  removeComparisonFilterChip,
  type ComparisonFilters,
} from "./comparison-filters";

interface ComparisonActiveFilterBarProps {
  filters: ComparisonFilters;
  onChange: (next: ComparisonFilters) => void;
  onClearAll: () => void;
}

export function ComparisonActiveFilterBar({
  filters,
  onChange,
  onClearAll,
}: ComparisonActiveFilterBarProps) {
  const chips = buildComparisonFilterChips(filters);
  const total = countActiveComparisonFilters(filters);

  if (total === 0) return null;

  return (
    <div className="flex-shrink-0 border-b border-border bg-muted/30 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Filtres actifs
          <Badge variant="default" className="h-5 min-w-5 px-1.5 text-[10px] tabular-nums">
            {total}
          </Badge>
        </span>
        {chips.map((chip) => (
          <button
            key={chip.id}
            type="button"
            onClick={() => onChange(removeComparisonFilterChip(filters, chip.id))}
            className="group inline-flex max-w-[280px] items-center gap-1 rounded-full border border-border bg-card py-1 pr-1 pl-2.5 text-xs shadow-[var(--shadow-soft)] transition-colors hover:border-primary/30 hover:bg-primary/5"
            title={`Retirer : ${chip.category} — ${chip.label}`}
          >
            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-primary/80">
              {chip.category}
            </span>
            <span className="truncate font-medium text-foreground">{chip.label}</span>
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground group-hover:bg-destructive/10 group-hover:text-destructive">
              <X size={12} weight="bold" />
            </span>
          </button>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClearAll}
          className="ml-auto text-primary"
        >
          Tout effacer
        </Button>
      </div>
    </div>
  );
}
