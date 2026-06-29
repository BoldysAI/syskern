import type { SimulationFilters, SimulationStatus, SimulationType } from "@/lib/api";

export const SIMULATION_TYPE_OPTIONS: { value: SimulationType; label: string }[] = [
  { value: "tariff", label: "Tarif" },
  { value: "project", label: "Projet" },
];

export const SIMULATION_STATUS_OPTIONS: { value: SimulationStatus; label: string }[] = [
  { value: "draft", label: "Brouillon" },
  { value: "finalized", label: "Finalisé" },
  { value: "archived", label: "Archivé" },
];

export function countActiveSimulationFilters(filters: SimulationFilters): number {
  let n = 0;
  if (filters.q?.trim()) n += 1;
  if (filters.simulation_type?.length) n += 1;
  if (filters.status?.length) n += 1;
  if (filters.is_dirty === true) n += 1;
  return n;
}

export function isEmptySimulationFilter(filters: SimulationFilters): boolean {
  return countActiveSimulationFilters(filters) === 0;
}

export interface SimulationFilterChip {
  id: string;
  category: string;
  label: string;
}

export function buildSimulationFilterChips(filters: SimulationFilters): SimulationFilterChip[] {
  const chips: SimulationFilterChip[] = [];
  if (filters.q?.trim()) {
    chips.push({ id: "q", category: "Recherche", label: filters.q.trim() });
  }
  if (filters.simulation_type?.length) {
    const labels = filters.simulation_type.map(
      (t) => SIMULATION_TYPE_OPTIONS.find((o) => o.value === t)?.label ?? t,
    );
    chips.push({ id: "simulation_type", category: "Type", label: labels.join(", ") });
  }
  if (filters.status?.length) {
    const labels = filters.status.map(
      (s) => SIMULATION_STATUS_OPTIONS.find((o) => o.value === s)?.label ?? s,
    );
    chips.push({ id: "status", category: "Statut", label: labels.join(", ") });
  }
  if (filters.is_dirty === true) {
    chips.push({ id: "is_dirty", category: "État", label: "Recalcul nécessaire" });
  }
  return chips;
}

export function removeSimulationFilterChip(
  filters: SimulationFilters,
  chipId: string,
): SimulationFilters {
  switch (chipId) {
    case "q":
      return { ...filters, q: undefined };
    case "simulation_type":
      return { ...filters, simulation_type: undefined };
    case "status":
      return { ...filters, status: undefined };
    case "is_dirty":
      return { ...filters, is_dirty: undefined };
    default:
      return filters;
  }
}

export function normalizeSimulationFilters(filters: SimulationFilters): SimulationFilters {
  const toArray = (value: unknown): SimulationType[] | SimulationStatus[] | undefined => {
    if (Array.isArray(value)) return value.length ? value : undefined;
    if (typeof value === "string" && value) return [value as SimulationType];
    return undefined;
  };
  const raw = filters as SimulationFilters & {
    simulation_type?: SimulationType | SimulationType[];
    status?: SimulationStatus | SimulationStatus[];
  };
  return {
    ...filters,
    simulation_type: toArray(raw.simulation_type) as SimulationType[] | undefined,
    status: toArray(raw.status) as SimulationStatus[] | undefined,
  };
}
