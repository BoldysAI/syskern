import type { SimulationFilters, SimulationStatus, SimulationType } from "@/lib/api";
import { translate, type MessageKey } from "@/lib/i18n";

const TYPE_KEYS: Record<SimulationType, MessageKey> = {
  tariff: "simulator.type.tariff",
  project: "simulator.type.project",
};

const STATUS_KEYS: Record<SimulationStatus, MessageKey> = {
  draft: "simulator.status.draft",
  finalized: "simulator.status.finalized",
  archived: "simulator.status.archived",
};

export function simulationTypeOptions(locale: string): { value: SimulationType; label: string }[] {
  return (Object.keys(TYPE_KEYS) as SimulationType[]).map((value) => ({
    value,
    label: translate(TYPE_KEYS[value], locale),
  }));
}

export function simulationStatusOptions(
  locale: string,
): { value: SimulationStatus; label: string }[] {
  return (Object.keys(STATUS_KEYS) as SimulationStatus[]).map((value) => ({
    value,
    label: translate(STATUS_KEYS[value], locale),
  }));
}

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

export function buildSimulationFilterChips(
  filters: SimulationFilters,
  locale: string,
): SimulationFilterChip[] {
  const chips: SimulationFilterChip[] = [];
  if (filters.q?.trim()) {
    chips.push({
      id: "q",
      category: translate("simulator.filters.categorySearch", locale),
      label: filters.q.trim(),
    });
  }
  if (filters.simulation_type?.length) {
    const labels = filters.simulation_type.map((value) =>
      TYPE_KEYS[value] ? translate(TYPE_KEYS[value], locale) : value,
    );
    chips.push({
      id: "simulation_type",
      category: translate("simulator.filters.type", locale),
      label: labels.join(", "),
    });
  }
  if (filters.status?.length) {
    const labels = filters.status.map((value) =>
      STATUS_KEYS[value] ? translate(STATUS_KEYS[value], locale) : value,
    );
    chips.push({
      id: "status",
      category: translate("simulator.filters.status", locale),
      label: labels.join(", "),
    });
  }
  if (filters.is_dirty === true) {
    chips.push({
      id: "is_dirty",
      category: translate("simulator.filters.categoryState", locale),
      label: translate("simulator.status.dirty", locale),
    });
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
