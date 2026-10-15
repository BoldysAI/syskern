// Comparison list filters — mirrors the offers/simulations modules (CDC §6.9.8).

import type { MessageKey } from "@/lib/i18n";

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

export type ComparisonSimType = "tariff" | "project";
export type HasRecalcFilter = "true" | "false";

export interface ComparisonFilters {
  q?: string;
  has_recalculations?: HasRecalcFilter;
  sim_type?: ComparisonSimType[];
}

export const STRUCTURE_OPTIONS: { value: HasRecalcFilter }[] = [
  { value: "true" },
  { value: "false" },
];

export const SIM_TYPE_OPTIONS: { value: ComparisonSimType }[] = [
  { value: "tariff" },
  { value: "project" },
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

export function buildComparisonFilterChips(
  filters: ComparisonFilters,
  t: Translate,
): ComparisonFilterChip[] {
  const chips: ComparisonFilterChip[] = [];
  if (filters.q?.trim())
    chips.push({
      id: "q",
      category: t("comparator.filters.chipSearch"),
      label: filters.q.trim(),
    });
  if (filters.has_recalculations)
    chips.push({
      id: "has_recalculations",
      category: t("comparator.filters.chipStructure"),
      label:
        filters.has_recalculations === "true"
          ? t("comparator.filters.withRecalcs")
          : t("comparator.filters.simsOnly"),
    });
  if (filters.sim_type?.length)
    chips.push({
      id: "sim_type",
      category: t("comparator.simulations"),
      label: filters.sim_type
        .map((type) =>
          type === "tariff" ? t("comparator.type.tariff") : t("comparator.type.project"),
        )
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
