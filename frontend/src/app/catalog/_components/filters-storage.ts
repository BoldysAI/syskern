// Saved catalog filters — persisted in localStorage (CDC §4.1.1, not in DB).
import type { CatalogFilters } from "@/lib/api";

const STORAGE_KEY = "syskern:catalog-filters:v1";

export interface SavedFilter {
  id: string;
  name: string;
  filters: CatalogFilters;
}

/** Migrate legacy single-value filters to multi-select arrays. */
function toStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.length ? value : undefined;
  if (typeof value === "string" && value) return [value];
  return undefined;
}

/** Migrate legacy `stock` dropdown values to checkbox fields. */
export function normalizeCatalogFilters(f: CatalogFilters): CatalogFilters {
  const raw = f as CatalogFilters & {
    stock?: "in" | "out" | "";
    universe?: string | string[];
    family?: string | string[];
    range?: string | string[];
    sub_range?: string | string[];
    brand?: string | string[];
    supplier?: string | string[];
  };
  const next: CatalogFilters = {
    ...f,
    universe: toStringArray(raw.universe),
    family: toStringArray(raw.family),
    range: toStringArray(raw.range),
    sub_range: toStringArray(raw.sub_range),
    brand: toStringArray(raw.brand),
    supplier: toStringArray(raw.supplier),
  };
  if (raw.stock === "in") {
    next.stock_in = true;
    next.stock_out = false;
  } else if (raw.stock === "out") {
    next.stock_in = false;
    next.stock_out = true;
  }
  if (next.stock_in && next.stock_out) {
    next.stock_in = false;
    next.stock_out = false;
  }
  if (next.stock_out) {
    next.stock_min = null;
  }
  return next;
}

/** Read saved filters; tolerant to SSR, quota and malformed payloads. */
export function loadSavedFilters(): SavedFilter[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as SavedFilter[]).map((sf) => ({
      ...sf,
      filters: normalizeCatalogFilters(sf.filters),
    }));
  } catch {
    return [];
  }
}

export function persistSavedFilters(filters: SavedFilter[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // Ignore quota / private-mode errors.
  }
}

/** True when no filter criteria are set (used to disable "save"). */
export function isEmptyFilter(f: CatalogFilters): boolean {
  return (
    !f.q &&
    !f.universe?.length &&
    !f.family?.length &&
    !f.range?.length &&
    !f.sub_range?.length &&
    !f.brand?.length &&
    !f.supplier?.length &&
    !f.stock_in &&
    !f.stock_out &&
    (f.stock_min == null || f.stock_min <= 0) &&
    (f.pamp_min == null || f.pamp_min <= 0) &&
    (f.pamp_max == null || f.pamp_max <= 0) &&
    Object.values(f.attrs ?? {}).every((v) => (Array.isArray(v) ? v.length === 0 : !v))
  );
}
