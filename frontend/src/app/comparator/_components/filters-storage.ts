import { normalizeComparisonFilters, type ComparisonFilters } from "./comparison-filters";

const STORAGE_KEY = "syskern:comparison-filters:v1";

export interface SavedComparisonFilter {
  id: string;
  name: string;
  filters: ComparisonFilters;
}

export function loadSavedComparisonFilters(): SavedComparisonFilter[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as SavedComparisonFilter[]).map((sf) => ({
      ...sf,
      filters: normalizeComparisonFilters(sf.filters),
    }));
  } catch {
    return [];
  }
}

export function persistSavedComparisonFilters(filters: SavedComparisonFilter[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // Ignore quota / private-mode errors.
  }
}
