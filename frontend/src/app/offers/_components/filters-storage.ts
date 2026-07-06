import { normalizeOfferFilters, type OfferFilters } from "./offer-filters";

const STORAGE_KEY = "syskern:offer-filters:v1";

export interface SavedOfferFilter {
  id: string;
  name: string;
  filters: OfferFilters;
}

export function loadSavedOfferFilters(): SavedOfferFilter[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as SavedOfferFilter[]).map((sf) => ({
      ...sf,
      filters: normalizeOfferFilters(sf.filters),
    }));
  } catch {
    return [];
  }
}

export function persistSavedOfferFilters(filters: SavedOfferFilter[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // Ignore quota / private-mode errors.
  }
}
