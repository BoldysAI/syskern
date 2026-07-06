import { normalizeLibraryFilters, type LibraryFilters } from "./library-filters";

const STORAGE_KEY = "syskern:library-filters:v1";

export interface SavedLibraryFilter {
  id: string;
  name: string;
  filters: LibraryFilters;
}

export function loadSavedLibraryFilters(): SavedLibraryFilter[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as SavedLibraryFilter[]).map((sf) => ({
      ...sf,
      filters: normalizeLibraryFilters(sf.filters),
    }));
  } catch {
    return [];
  }
}

export function persistSavedLibraryFilters(filters: SavedLibraryFilter[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // Ignore quota / private-mode errors.
  }
}
