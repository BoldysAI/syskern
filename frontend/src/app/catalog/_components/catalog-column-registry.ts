/** Registry of catalog table columns (core product fields + dynamic attributes). */

export type CatalogColumnKind = "core" | "attribute";

export interface CatalogColumnMeta {
  key: string;
  label: string;
  kind: CatalogColumnKind;
  /** Cannot be hidden (e.g. SKU). */
  locked?: boolean;
}

/** Core columns available on the product list API (no attr_columns param). */
export const CATALOG_CORE_COLUMN_META: CatalogColumnMeta[] = [
  { key: "sku_code", label: "SKU", kind: "core", locked: true },
  { key: "name", label: "Désignation", kind: "core" },
  { key: "universe", label: "Univers", kind: "core" },
  { key: "family", label: "Famille", kind: "core" },
  { key: "range", label: "Gamme", kind: "core" },
  { key: "sub_range", label: "Sous-gamme", kind: "core" },
  { key: "brand", label: "Marque", kind: "core" },
  { key: "active_supplier", label: "Fournisseur actif", kind: "core" },
  { key: "pamp_eur", label: "PAMP", kind: "core" },
  { key: "catalog_pv", label: "PV", kind: "core" },
  { key: "stock_quantity", label: "Stock", kind: "core" },
  { key: "is_copper_indexed", label: "Indexé cuivre", kind: "core" },
  { key: "is_active", label: "Actif", kind: "core" },
  { key: "lang_coverage", label: "Langues", kind: "core" },
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
export function orderVisibleColumnKeys(
  visibleKeys: string[],
  attributeKeys: string[],
): string[] {
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
