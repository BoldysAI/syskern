import { CATALOG_NO_SUPPLIER_VALUE, type CatalogFilters } from "@/lib/api";
import type { MessageKey } from "@/lib/i18n";

export interface FilterChip {
  /** Stable id for React keys and removal. */
  id: string;
  /** Product or user content (search text, brand, hierarchy value, attribute value). */
  label?: string;
  labelKey?: MessageKey;
  labelVars?: Record<string, string | number>;
  /** Attribute label (registry content) when `categoryKey` is absent. */
  category?: string;
  categoryKey?: MessageKey;
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
  n += f.active_supplier?.length ?? 0;
  if (f.active_in) n++;
  if (f.active_out) n++;
  if (f.stock_in) n++;
  if (f.stock_out) n++;
  if (!f.stock_out && f.stock_min != null && f.stock_min > 0) n++;
  if (f.pamp_min != null && f.pamp_min > 0) n++;
  if (f.pamp_max != null && f.pamp_max > 0) n++;
  if (f.i18n_incomplete) n++;
  if (f.lang_fr_in) n++;
  if (f.lang_fr_out) n++;
  if (f.lang_en_in) n++;
  if (f.lang_en_out) n++;
  if (f.lang_es_in) n++;
  if (f.lang_es_out) n++;
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
  "active_supplier",
] as const;

type ArrayFilterKey = (typeof ARRAY_KEYS)[number];

const ARRAY_LABELS: Record<ArrayFilterKey, MessageKey> = {
  universe: "catalog.column.universe",
  family: "catalog.column.family",
  range: "catalog.column.range",
  sub_range: "catalog.column.subRange",
  brand: "catalog.column.brand",
  supplier: "catalog.column.supplier",
  active_supplier: "catalog.column.activeSupplier",
};

/** Build removable chips for the active filter bar. */
export function buildFilterChips(
  filters: CatalogFilters,
  attrLabels: Record<string, string> = {}
): FilterChip[] {
  const chips: FilterChip[] = [];

  if (filters.q?.trim()) {
    chips.push({ id: "q", label: filters.q.trim(), categoryKey: "catalog.filters.search" });
  }

  for (const key of ARRAY_KEYS) {
    const values = filters[key];
    if (!values?.length) continue;
    const categoryKey = ARRAY_LABELS[key];
    for (const v of values) {
      const noSupplier =
        (key === "supplier" || key === "active_supplier") && v === CATALOG_NO_SUPPLIER_VALUE;
      chips.push({
        id: `${key}:${v}`,
        ...(noSupplier ? { labelKey: "catalog.supplier.none" as const } : { label: v }),
        categoryKey,
      });
    }
  }

  if (filters.active_in) {
    chips.push({
      id: "active_in",
      labelKey: "catalog.column.active",
      categoryKey: "catalog.filters.status",
    });
  }
  if (filters.active_out) {
    chips.push({
      id: "active_out",
      labelKey: "catalog.filters.inactive",
      categoryKey: "catalog.filters.status",
    });
  }

  if (filters.stock_in) {
    chips.push({
      id: "stock_in",
      labelKey: "catalog.filters.inStock",
      categoryKey: "catalog.column.stock",
    });
  }
  if (filters.stock_out) {
    chips.push({
      id: "stock_out",
      labelKey: "catalog.filters.outOfStock",
      categoryKey: "catalog.column.stock",
    });
  }
  if (!filters.stock_out && filters.stock_min != null && filters.stock_min > 0) {
    chips.push({
      id: "stock_min",
      labelKey: "catalog.filters.stockMin",
      labelVars: { min: filters.stock_min },
      categoryKey: "catalog.column.stock",
    });
  }

  if (filters.pamp_min != null && filters.pamp_min > 0) {
    chips.push({
      id: "pamp_min",
      labelKey: "catalog.filters.pampMin",
      labelVars: { min: filters.pamp_min },
      categoryKey: "catalog.column.pamp",
    });
  }
  if (filters.pamp_max != null && filters.pamp_max > 0) {
    chips.push({
      id: "pamp_max",
      labelKey: "catalog.filters.pampMax",
      labelVars: { max: filters.pamp_max },
      categoryKey: "catalog.column.pamp",
    });
  }

  if (filters.i18n_incomplete) {
    chips.push({
      id: "i18n_incomplete",
      labelKey: "catalog.filters.langMissing",
      categoryKey: "catalog.column.languages",
    });
  }
  if (filters.lang_fr_in) {
    chips.push({
      id: "lang_fr_in",
      labelKey: "catalog.filters.langFrIn",
      categoryKey: "catalog.column.languages",
    });
  }
  if (filters.lang_fr_out) {
    chips.push({
      id: "lang_fr_out",
      labelKey: "catalog.filters.langFrOut",
      categoryKey: "catalog.column.languages",
    });
  }
  if (filters.lang_en_in) {
    chips.push({
      id: "lang_en_in",
      labelKey: "catalog.filters.langEnIn",
      categoryKey: "catalog.column.languages",
    });
  }
  if (filters.lang_en_out) {
    chips.push({
      id: "lang_en_out",
      labelKey: "catalog.filters.langEnOut",
      categoryKey: "catalog.column.languages",
    });
  }
  if (filters.lang_es_in) {
    chips.push({
      id: "lang_es_in",
      labelKey: "catalog.filters.langEsIn",
      categoryKey: "catalog.column.languages",
    });
  }
  if (filters.lang_es_out) {
    chips.push({
      id: "lang_es_out",
      labelKey: "catalog.filters.langEsOut",
      categoryKey: "catalog.column.languages",
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
  if (chipId === "i18n_incomplete") return { ...filters, i18n_incomplete: false };
  if (chipId === "lang_fr_in") return { ...filters, lang_fr_in: false };
  if (chipId === "lang_fr_out") return { ...filters, lang_fr_out: false };
  if (chipId === "lang_en_in") return { ...filters, lang_en_in: false };
  if (chipId === "lang_en_out") return { ...filters, lang_en_out: false };
  if (chipId === "lang_es_in") return { ...filters, lang_es_in: false };
  if (chipId === "lang_es_out") return { ...filters, lang_es_out: false };

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
