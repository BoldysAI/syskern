import type { CatalogFilters } from "@/lib/api";

export interface FilterChip {
  /** Stable id for React keys and removal. */
  id: string;
  label: string;
  category: string;
}

/** Count individual active criteria (each selected value = 1). */
export function countActiveFilters(f: CatalogFilters): number {
  let n = 0;
  if (f.q?.trim()) n++;
  n += f.universe?.length ?? 0;
  n += f.family?.length ?? 0;
  n += f.range?.length ?? 0;
  n += f.sub_range?.length ?? 0;
  n += f.brand?.length ?? 0;
  n += f.supplier?.length ?? 0;
  if (f.active_in) n++;
  if (f.active_out) n++;
  if (f.stock_in) n++;
  if (f.stock_out) n++;
  if (!f.stock_out && f.stock_min != null && f.stock_min > 0) n++;
  if (f.pamp_min != null && f.pamp_min > 0) n++;
  if (f.pamp_max != null && f.pamp_max > 0) n++;
  for (const v of Object.values(f.attrs ?? {})) {
    if (Array.isArray(v)) n += v.length;
    else if (v) n++;
  }
  return n;
}

const ARRAY_KEYS = [
  "universe",
  "family",
  "range",
  "sub_range",
  "brand",
  "supplier",
] as const;

type ArrayFilterKey = (typeof ARRAY_KEYS)[number];

const ARRAY_LABELS: Record<ArrayFilterKey, string> = {
  universe: "Univers",
  family: "Famille",
  range: "Gamme",
  sub_range: "Sous-gamme",
  brand: "Marque",
  supplier: "Fournisseur",
};

/** Build removable chips for the active filter bar. */
export function buildFilterChips(
  filters: CatalogFilters,
  attrLabels: Record<string, string> = {}
): FilterChip[] {
  const chips: FilterChip[] = [];

  if (filters.q?.trim()) {
    chips.push({ id: "q", label: filters.q.trim(), category: "Recherche" });
  }

  for (const key of ARRAY_KEYS) {
    const values = filters[key];
    if (!values?.length) continue;
    const category = ARRAY_LABELS[key];
    for (const v of values) {
      chips.push({ id: `${key}:${v}`, label: v, category });
    }
  }

  if (filters.active_in) {
    chips.push({ id: "active_in", label: "Actif", category: "Statut" });
  }
  if (filters.active_out) {
    chips.push({ id: "active_out", label: "Non actif", category: "Statut" });
  }

  if (filters.stock_in) {
    chips.push({ id: "stock_in", label: "En stock", category: "Stock" });
  }
  if (filters.stock_out) {
    chips.push({ id: "stock_out", label: "Rupture", category: "Stock" });
  }
  if (!filters.stock_out && filters.stock_min != null && filters.stock_min > 0) {
    chips.push({
      id: "stock_min",
      label: `Stock ≥ ${filters.stock_min}`,
      category: "Stock",
    });
  }

  if (filters.pamp_min != null && filters.pamp_min > 0) {
    chips.push({
      id: "pamp_min",
      label: `PAMP ≥ ${filters.pamp_min} €`,
      category: "PAMP",
    });
  }
  if (filters.pamp_max != null && filters.pamp_max > 0) {
    chips.push({
      id: "pamp_max",
      label: `PAMP ≤ ${filters.pamp_max} €`,
      category: "PAMP",
    });
  }

  for (const [code, raw] of Object.entries(filters.attrs ?? {})) {
    const category = attrLabels[code] ?? code;
    const values = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
    for (const v of values) {
      chips.push({ id: `attr:${code}:${v}`, label: v, category });
    }
  }

  return chips;
}

function toggleArrayValue(list: string[] | undefined, value: string): string[] {
  return (list ?? []).filter((x) => x !== value);
}

/** Return filters with one chip removed. */
export function removeFilterChip(filters: CatalogFilters, chipId: string): CatalogFilters {
  if (chipId === "q") {
    const next = { ...filters };
    delete next.q;
    return next;
  }
  if (chipId === "active_in") return { ...filters, active_in: false };
  if (chipId === "active_out") return { ...filters, active_out: false };
  if (chipId === "stock_in") return { ...filters, stock_in: false };
  if (chipId === "stock_out") return { ...filters, stock_out: false };
  if (chipId === "stock_min") return { ...filters, stock_min: null };
  if (chipId === "pamp_min") return { ...filters, pamp_min: null };
  if (chipId === "pamp_max") return { ...filters, pamp_max: null };

  for (const key of ARRAY_KEYS) {
    const prefix = `${key}:`;
    if (chipId.startsWith(prefix)) {
      const value = chipId.slice(prefix.length);
      const next = toggleArrayValue(filters[key], value);
      return { ...filters, [key]: next.length ? next : undefined };
    }
  }

  if (chipId.startsWith("attr:")) {
    const [, code, ...rest] = chipId.split(":");
    const value = rest.join(":");
    const attrs = { ...(filters.attrs ?? {}) };
    const current = attrs[code];
    if (Array.isArray(current)) {
      const next = current.filter((v) => v !== value);
      if (next.length) attrs[code] = next;
      else delete attrs[code];
    } else if (current === value || String(current) === value) {
      delete attrs[code];
    }
    return { ...filters, attrs: Object.keys(attrs).length ? attrs : undefined };
  }

  return filters;
}
