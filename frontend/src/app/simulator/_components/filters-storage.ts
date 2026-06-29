import type { SimulationFilters } from "@/lib/api";
import { normalizeSimulationFilters } from "./simulation-filters";

const STORAGE_KEY = "syskern:simulation-filters:v1";

export interface SavedSimulationFilter {
  id: string;
  name: string;
  filters: SimulationFilters;
}

export function loadSavedSimulationFilters(): SavedSimulationFilter[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as SavedSimulationFilter[]).map((sf) => ({
      ...sf,
      filters: normalizeSimulationFilters(sf.filters),
    }));
  } catch {
    return [];
  }
}

export function persistSavedSimulationFilters(filters: SavedSimulationFilter[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // Ignore quota / private-mode errors.
  }
}
