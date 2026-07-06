import { normalizeQuarantineFilters, type QuarantineFilters } from "./quarantine-filters";

const STORAGE_KEY = "syskern:quarantine-filters:v1";

export interface SavedQuarantineFilter {
  id: string;
  name: string;
  filters: QuarantineFilters;
}

export function loadSavedQuarantineFilters(): SavedQuarantineFilter[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as SavedQuarantineFilter[]).map((sf) => ({
      ...sf,
      filters: normalizeQuarantineFilters(sf.filters),
    }));
  } catch {
    return [];
  }
}

export function persistSavedQuarantineFilters(filters: SavedQuarantineFilter[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // Ignore quota / private-mode errors.
  }
}
