/** Registry of catalog table columns (core product fields + dynamic attributes). */

import type { MessageKey } from "@/lib/i18n";

export type CatalogColumnKind = "core" | "attribute";

export interface CatalogColumnMeta {
  key: string;
  labelKey: MessageKey;
  kind: CatalogColumnKind;
  /** Cannot be hidden (e.g. SKU). */
  locked?: boolean;
}

/** Core columns available on the product list API (no attr_columns param). */
export const CATALOG_CORE_COLUMN_META: CatalogColumnMeta[] = [
  { key: "sku_code", labelKey: "catalog.column.sku", kind: "core", locked: true },
  { key: "name", labelKey: "catalog.column.designation", kind: "core" },
  { key: "universe", labelKey: "catalog.column.universe", kind: "core" },
  { key: "family", labelKey: "catalog.column.family", kind: "core" },
  { key: "range", labelKey: "catalog.column.range", kind: "core" },
  { key: "sub_range", labelKey: "catalog.column.subRange", kind: "core" },
  { key: "brand", labelKey: "catalog.column.brand", kind: "core" },
  { key: "active_supplier", labelKey: "catalog.column.activeSupplier", kind: "core" },
  { key: "pamp_eur", labelKey: "catalog.column.pamp", kind: "core" },
  { key: "catalog_pv", labelKey: "catalog.column.pv", kind: "core" },
  { key: "stock_quantity", labelKey: "catalog.column.stock", kind: "core" },
  { key: "is_copper_indexed", labelKey: "catalog.column.copperIndexed", kind: "core" },
  { key: "is_active", labelKey: "catalog.column.active", kind: "core" },
  { key: "lang_coverage", labelKey: "catalog.column.languages", kind: "core" },
  { key: "completeness_pct", labelKey: "catalog.column.completeness", kind: "core" },
];

/** Default visible columns on first visit / after reset. */
export const DEFAULT_VISIBLE_CATALOG_COLUMNS: string[] = [
  "sku_code",
  "name",
  "universe",
  "family",
  "active_supplier",
  "pamp_eur",
  "stock_quantity",
  "is_active",
  "completeness_pct",
];

export function attrColumnKey(code: string): string {
  return `attr:${code}`;
}

/** Backend `ordering` param for a dynamic attribute column. */
export function attrSortField(code: string): string {
  return `attr_${code}`;
}

export function parseAttrColumnKey(key: string): string | null {
  return key.startsWith("attr:") ? key.slice(5) : null;
}

/** Merge core order with attribute keys (attributes after visible core columns). */
export function orderVisibleColumnKeys(visibleKeys: string[], attributeKeys: string[]): string[] {
  const visible = new Set(visibleKeys);
  const core = CATALOG_COLUMN_ORDER.filter((k) => visible.has(k));
  const attrs = attributeKeys.filter((k) => visible.has(k));
  return [...core, ...attrs];
}

export function ensureLockedColumns(keys: string[]): string[] {
  const locked = CATALOG_CORE_COLUMN_META.filter((c) => c.locked).map((c) => c.key);
  const set = new Set(keys);
  for (const k of locked) set.add(k);
  const allKeys = [...set];
  const attrKeys = allKeys.filter((k) => k.startsWith("attr:"));
  return orderVisibleColumnKeys(allKeys, attrKeys);
}

/** Display order for core columns. */
export const CATALOG_COLUMN_ORDER: string[] = CATALOG_CORE_COLUMN_META.map((c) => c.key);
