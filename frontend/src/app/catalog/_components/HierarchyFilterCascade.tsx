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
import type { MessageKey } from "@/lib/i18n";
import { useUiTranslate } from "@/lib/use-ui-translate";
import { cn } from "@/lib/utils";
import { FilterCheckboxGroup } from "@/components/FilterCheckboxGroup";
import { AppIcon } from "@/components/AppIcon";
import {
  fetchHierarchyOptions,
  hierarchyOptionsSwrKey,
  type CatalogFiltersUpdater,
} from "./hierarchy-utils";

const LEVELS = [
  {
    key: "universe" as const,
    labelKey: "catalog.column.universe" as const satisfies MessageKey,
    hintKey: "catalog.hierarchy.universeHint" as const satisfies MessageKey,
    icon: TreeStructure,
    parentKeys: [] as const,
  },
  {
    key: "family" as const,
    labelKey: "catalog.column.family" as const satisfies MessageKey,
    hintKey: "catalog.hierarchy.familyHint" as const satisfies MessageKey,
    icon: Folder,
    parentKeys: ["universe"] as const,
  },
  {
    key: "range" as const,
    labelKey: "catalog.column.range" as const satisfies MessageKey,
    hintKey: "catalog.hierarchy.rangeHint" as const satisfies MessageKey,
    icon: FolderOpen,
    parentKeys: ["universe", "family"] as const,
  },
  {
    key: "sub_range" as const,
    labelKey: "catalog.column.subRange" as const satisfies MessageKey,
    hintKey: "catalog.hierarchy.subRangeHint" as const satisfies MessageKey,
    icon: Package,
    parentKeys: ["universe", "family", "range"] as const,
  },
] as const;

type LevelKey = (typeof LEVELS)[number]["key"];

interface HierarchyFilterCascadeProps {
  filters: CatalogFilters;
  onChange: (next: CatalogFiltersUpdater) => void;
}

interface LevelStepProps {
  level: (typeof LEVELS)[number];
  selected: string[];
  parents: Pick<CatalogFilters, "universe" | "family" | "range">;
  parentMissing: boolean;
  onSetLevel: (key: LevelKey, next: string[]) => void;
}

const HierarchyLevelStep = memo(function HierarchyLevelStep({
  level,
  selected,
  parents,
  parentMissing,
  onSetLevel,
}: LevelStepProps) {
  const t = useUiTranslate();
  const hasSelection = selected.length > 0;
  const [open, setOpen] = useState(false);

  const swrKey = useMemo(
    () => (open ? hierarchyOptionsSwrKey(level.key, parents) : null),
    [open, level.key, parents],
  );

  const { data: options, isLoading } = useSWR(
    swrKey,
    () => fetchHierarchyOptions(level.key, parents),
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );

  const optionList = useMemo(() => {
    const merged = new Set([...(options ?? []), ...selected]);
    return [...merged]
      .sort((a, b) => a.localeCompare(b, "fr"))
      .map((o) => ({ value: o, label: o }));
  }, [options, selected]);

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
              <p className="text-xs font-semibold text-foreground">{t(level.labelKey)}</p>
              {hasSelection ? (
                <p className="text-[11px] text-muted-foreground">
                  {t(
                    selected.length > 1 ? "catalog.selection.other" : "catalog.selection.one",
                    { count: selected.length },
                  )}
                </p>
              ) : (
                <p className="text-[11px] text-muted-foreground">{t("catalog.hierarchy.expand")}</p>
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

        <Collapsible.Content
          className="p-2.5 data-[state=closed]:hidden"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {parentMissing && level.key !== "universe" && (
            <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground">{t(level.hintKey)}</p>
          )}

          {isLoading && !options?.length ? (
            <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
              <CircleNotch size={14} className="animate-spin" />
              {t("common.loading")}
            </div>
          ) : optionList.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">
              {t("catalog.hierarchy.empty")}
            </p>
          ) : (
            <FilterCheckboxGroup
              options={optionList}
              selected={selected}
              onChange={(next) => onSetLevel(level.key, next)}
              searchable={optionList.length > 5}
              maxHeight="max-h-40"
              idPrefix={`hierarchy-${level.key}`}
            />
          )}
        </Collapsible.Content>
      </div>
    </Collapsible.Root>
  );
});

export function HierarchyFilterCascade({ filters, onChange }: HierarchyFilterCascadeProps) {
  const t = useUiTranslate();
  const parents = useMemo(
    () => ({
      universe: filters.universe,
      family: filters.family,
      range: filters.range,
    }),
    [filters.universe, filters.family, filters.range],
  );

  const setLevel = (key: LevelKey, next: string[]) => {
    onChange((prev) => {
      const value = next.length ? next : undefined;

      if (!value) {
        if (key === "universe") {
          return {
            ...prev,
            universe: undefined,
            family: undefined,
            range: undefined,
            sub_range: undefined,
          };
        }
        if (key === "family") {
          return { ...prev, family: undefined, range: undefined, sub_range: undefined };
        }
        if (key === "range") {
          return { ...prev, range: undefined, sub_range: undefined };
        }
        return { ...prev, sub_range: undefined };
      }

      return { ...prev, [key]: value };
    });
  };

  const selectedPath = [
    filters.universe?.length
      ? t("catalog.hierarchy.universeCount", { count: filters.universe.length })
      : null,
    filters.family?.length
      ? t(filters.family.length > 1 ? "catalog.hierarchy.familyOther" : "catalog.hierarchy.familyOne", {
          count: filters.family.length,
        })
      : null,
    filters.range?.length
      ? t(filters.range.length > 1 ? "catalog.hierarchy.rangeOther" : "catalog.hierarchy.rangeOne", {
          count: filters.range.length,
        })
      : null,
    filters.sub_range?.length
      ? t(
          filters.sub_range.length > 1
            ? "catalog.hierarchy.subRangeOther"
            : "catalog.hierarchy.subRangeOne",
          { count: filters.sub_range.length },
        )
      : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-3">
      {selectedPath.length > 0 && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">
            {t("catalog.hierarchy.selection")}
          </p>
          <p className="mt-0.5 text-xs text-foreground">{selectedPath.join(" · ")}</p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {LEVELS.map((level) => {
          const parentMissing =
            level.parentKeys.length > 0 && level.parentKeys.every((k) => !filters[k]?.length);

          return (
            <HierarchyLevelStep
              key={level.key}
              level={level}
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
