"use client";

import { memo, useMemo, useState } from "react";
import useSWR from "swr";
import * as Collapsible from "@radix-ui/react-collapsible";
import {
  CaretDown,
  CircleNotch,
  Folder,
  FolderOpen,
  Package,
  TreeStructure,
} from "@phosphor-icons/react";
import type { CatalogFilters } from "@/lib/api";
import { cn } from "@/lib/utils";
import { FilterCheckboxGroup } from "@/components/FilterCheckboxGroup";
import { AppIcon } from "@/components/AppIcon";
import { fetchHierarchyOptions } from "./hierarchy-utils";

const LEVELS = [
  {
    key: "universe" as const,
    label: "Univers",
    hint: "Point de départ — affinez ensuite famille, gamme et sous-gamme.",
    icon: TreeStructure,
    parentKeys: [] as const,
  },
  {
    key: "family" as const,
    label: "Famille",
    hint: "Sélectionnez un univers pour affiner les familles disponibles.",
    icon: Folder,
    parentKeys: ["universe"] as const,
  },
  {
    key: "range" as const,
    label: "Gamme",
    hint: "Affinez par gamme une fois l'univers ou la famille choisi.",
    icon: FolderOpen,
    parentKeys: ["universe", "family"] as const,
  },
  {
    key: "sub_range" as const,
    label: "Sous-gamme",
    hint: "Niveau le plus fin de la hiérarchie produit.",
    icon: Package,
    parentKeys: ["universe", "family", "range"] as const,
  },
] as const;

type LevelKey = (typeof LEVELS)[number]["key"];

interface HierarchyFilterCascadeProps {
  filters: CatalogFilters;
  onChange: (next: CatalogFilters) => void;
}

interface LevelStepProps {
  level: (typeof LEVELS)[number];
  levelIndex: number;
  selected: string[];
  parents: Pick<CatalogFilters, "universe" | "family" | "range">;
  parentMissing: boolean;
  onSetLevel: (key: LevelKey, next: string[]) => void;
}

const HierarchyLevelStep = memo(function HierarchyLevelStep({
  level,
  levelIndex,
  selected,
  parents,
  parentMissing,
  onSetLevel,
}: LevelStepProps) {
  const hasSelection = selected.length > 0;
  const [open, setOpen] = useState(levelIndex === 0 ? true : hasSelection);

  const swrKey = useMemo(
    () =>
      open
        ? ([
            "hierarchy-cascade",
            level.key,
            parents.universe?.join("|") ?? "",
            parents.family?.join("|") ?? "",
            parents.range?.join("|") ?? "",
          ] as const)
        : null,
    [open, level.key, parents.universe, parents.family, parents.range],
  );

  const { data: options, isLoading } = useSWR(
    swrKey,
    () => fetchHierarchyOptions(level.key, parents),
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );

  const optionList = useMemo(
    () => (options ?? []).map((o) => ({ value: o, label: o })),
    [options],
  );

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen}>
      <div
        className={cn(
          "rounded-xl border bg-card/50 transition-colors",
          hasSelection ? "border-primary/30 shadow-[var(--shadow-soft)]" : "border-border",
        )}
      >
        <Collapsible.Trigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-2 border-b border-border/60 bg-muted/30 px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
          >
            <span
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
                hasSelection ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
              )}
            >
              <AppIcon icon={level.icon} size="sm" weight="duotone" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-foreground">{level.label}</p>
              {hasSelection ? (
                <p className="text-[11px] text-muted-foreground">
                  {selected.length} sélectionné{selected.length > 1 ? "s" : ""}
                </p>
              ) : (
                <p className="text-[11px] text-muted-foreground">Cliquer pour développer</p>
              )}
            </div>
            <CaretDown
              size={14}
              className={cn(
                "shrink-0 text-muted-foreground transition-transform duration-200",
                open && "rotate-180",
              )}
            />
          </button>
        </Collapsible.Trigger>

        <Collapsible.Content className="p-2.5 data-[state=closed]:hidden">
          {parentMissing && level.key !== "universe" && (
            <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground">{level.hint}</p>
          )}

          {isLoading && !options?.length ? (
            <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
              <CircleNotch size={14} className="animate-spin" />
              Chargement…
            </div>
          ) : optionList.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">Aucune valeur disponible</p>
          ) : (
            <FilterCheckboxGroup
              options={optionList}
              selected={selected}
              onChange={(next) => onSetLevel(level.key, next)}
              searchable={optionList.length > 5}
              maxHeight="max-h-40"
              sortSelectedFirst
            />
          )}
        </Collapsible.Content>
      </div>
    </Collapsible.Root>
  );
});

export function HierarchyFilterCascade({ filters, onChange }: HierarchyFilterCascadeProps) {
  const parents = useMemo(
    () => ({
      universe: filters.universe,
      family: filters.family,
      range: filters.range,
    }),
    [filters.universe, filters.family, filters.range],
  );

  const setLevel = (key: LevelKey, next: string[]) => {
    const value = next.length ? next : undefined;
    if (key === "universe") {
      onChange({
        ...filters,
        universe: value,
        family: undefined,
        range: undefined,
        sub_range: undefined,
      });
      return;
    }
    if (key === "family") {
      onChange({ ...filters, family: value, range: undefined, sub_range: undefined });
      return;
    }
    if (key === "range") {
      onChange({ ...filters, range: value, sub_range: undefined });
      return;
    }
    onChange({ ...filters, sub_range: value });
  };

  const selectedPath = [
    filters.universe?.length ? `${filters.universe.length} univers` : null,
    filters.family?.length ? `${filters.family.length} famille${filters.family.length > 1 ? "s" : ""}` : null,
    filters.range?.length ? `${filters.range.length} gamme${filters.range.length > 1 ? "s" : ""}` : null,
    filters.sub_range?.length
      ? `${filters.sub_range.length} sous-gamme${filters.sub_range.length > 1 ? "s" : ""}`
      : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-3">
      {selectedPath.length > 0 && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">Sélection</p>
          <p className="mt-0.5 text-xs text-foreground">{selectedPath.join(" · ")}</p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {LEVELS.map((level, index) => {
          const parentMissing =
            level.parentKeys.length > 0 &&
            level.parentKeys.every((k) => !(filters[k]?.length));

          return (
            <HierarchyLevelStep
              key={level.key}
              level={level}
              levelIndex={index}
              selected={filters[level.key] ?? []}
              parents={parents}
              parentMissing={parentMissing}
              onSetLevel={setLevel}
            />
          );
        })}
      </div>
    </div>
  );
}
