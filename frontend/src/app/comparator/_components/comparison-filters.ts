// Comparison list filters — mirrors the offers/simulations modules (CDC §6.9.8).

export type ComparisonSimType = "tariff" | "project";
export type HasRecalcFilter = "true" | "false";

export interface ComparisonFilters {
  q?: string;
  has_recalculations?: HasRecalcFilter;
  sim_type?: ComparisonSimType[];
}

export const STRUCTURE_OPTIONS: { value: HasRecalcFilter; label: string }[] = [
  { value: "true", label: "Avec recalculs" },
  { value: "false", label: "Simulations seules" },
];

export const SIM_TYPE_OPTIONS: { value: ComparisonSimType; label: string }[] = [
  { value: "tariff", label: "Tarif" },
  { value: "project", label: "Projet" },
];

export function countActiveComparisonFilters(filters: ComparisonFilters): number {
  let n = 0;
  if (filters.q?.trim()) n += 1;
  if (filters.has_recalculations) n += 1;
  if (filters.sim_type?.length) n += 1;
  return n;
}

export function isEmptyComparisonFilter(filters: ComparisonFilters): boolean {
  return countActiveComparisonFilters(filters) === 0;
}

/** Convert to the `getComparisonsList` params (booleans/arrays). */
export function toComparisonParams(filters: ComparisonFilters): {
  q?: string;
  has_recalculations?: boolean;
  sim_type?: ComparisonSimType[];
} {
  return {
    q: filters.q?.trim() || undefined,
    has_recalculations:
      filters.has_recalculations === undefined ? undefined : filters.has_recalculations === "true",
    sim_type: filters.sim_type?.length ? filters.sim_type : undefined,
  };
}

export interface ComparisonFilterChip {
  id: string;
  category: string;
  label: string;
}

export function buildComparisonFilterChips(filters: ComparisonFilters): ComparisonFilterChip[] {
  const chips: ComparisonFilterChip[] = [];
  if (filters.q?.trim()) chips.push({ id: "q", category: "Recherche", label: filters.q.trim() });
  if (filters.has_recalculations)
    chips.push({
      id: "has_recalculations",
      category: "Structure",
      label:
        STRUCTURE_OPTIONS.find((o) => o.value === filters.has_recalculations)?.label ??
        filters.has_recalculations,
    });
  if (filters.sim_type?.length)
    chips.push({
      id: "sim_type",
      category: "Simulations",
      label: filters.sim_type
        .map((t) => SIM_TYPE_OPTIONS.find((o) => o.value === t)?.label ?? t)
        .join(", "),
    });
  return chips;
}

export function removeComparisonFilterChip(
  filters: ComparisonFilters,
  chipId: string,
): ComparisonFilters {
  switch (chipId) {
    case "q":
      return { ...filters, q: undefined };
    case "has_recalculations":
      return { ...filters, has_recalculations: undefined };
    case "sim_type":
      return { ...filters, sim_type: undefined };
    default:
      return filters;
  }
}

export function normalizeComparisonFilters(filters: ComparisonFilters): ComparisonFilters {
  const raw = filters as ComparisonFilters & Record<string, unknown>;
  const toArray = (value: unknown): ComparisonSimType[] | undefined => {
    if (Array.isArray(value)) return value.length ? (value as ComparisonSimType[]) : undefined;
    if (typeof value === "string" && value) return [value as ComparisonSimType];
    return undefined;
  };
  const hr =
    raw.has_recalculations === "true" || raw.has_recalculations === "false"
      ? raw.has_recalculations
      : undefined;
  return {
    q: typeof raw.q === "string" ? raw.q : undefined,
    has_recalculations: hr,
    sim_type: toArray(raw.sim_type),
  };
}
