import { getHierarchyLevel, type CatalogFilters, type HierarchyLevel } from "@/lib/api";

type HierarchyParents = Pick<CatalogFilters, "universe" | "family" | "range">;

function parentParams(
  level: HierarchyLevel,
  parents: HierarchyParents,
): { universe?: string; family?: string; range?: string } {
  const p: { universe?: string; family?: string; range?: string } = {};
  if (parents.universe?.length) p.universe = parents.universe.join(",");
  if (level !== "universe" && parents.family?.length) p.family = parents.family.join(",");
  if (level === "sub_range" && parents.range?.length) p.range = parents.range.join(",");
  return p;
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
