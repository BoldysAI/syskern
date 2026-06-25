import { getHierarchyLevel, type CatalogFilters, type HierarchyLevel } from "@/lib/api";

export type CatalogFiltersUpdater = CatalogFilters | ((prev: CatalogFilters) => CatalogFilters);

type HierarchyParents = Pick<CatalogFilters, "universe" | "family" | "range">;

/** Parent levels scoped to each hierarchy level (never includes the level itself). */
export const HIERARCHY_ANCESTORS: Record<HierarchyLevel, (keyof HierarchyParents)[]> = {
  universe: [],
  family: ["universe"],
  range: ["universe", "family"],
  sub_range: ["universe", "family", "range"],
};

function parentParams(
  level: HierarchyLevel,
  parents: HierarchyParents,
): { universe?: string; family?: string; range?: string } {
  const p: { universe?: string; family?: string; range?: string } = {};
  for (const key of HIERARCHY_ANCESTORS[level]) {
    const vals = parents[key];
    if (vals?.length) p[key] = vals.join(",");
  }
  return p;
}

/** Stable SWR key — only ancestor selections, not the current level's own selection. */
export function hierarchyOptionsSwrKey(
  level: HierarchyLevel,
  parents: HierarchyParents,
): readonly string[] {
  return [
    "hierarchy-cascade",
    level,
    ...HIERARCHY_ANCESTORS[level].map((k) => parents[k]?.join("|") ?? ""),
  ];
}

/** Fetch distinct hierarchy values — one API call per level (CSV parent filters). */
export async function fetchHierarchyOptions(
  level: HierarchyLevel,
  parents: HierarchyParents,
): Promise<string[]> {
  return getHierarchyLevel(level, parentParams(level, parents));
}

/** Keep only selections that still exist in the refreshed option list. */
export function pruneHierarchySelection(
  selected: string[] | undefined,
  options: string[],
): string[] | undefined {
  if (!selected?.length) return undefined;
  const allowed = new Set(options);
  const next = selected.filter((v) => allowed.has(v));
  return next.length ? next : undefined;
}
