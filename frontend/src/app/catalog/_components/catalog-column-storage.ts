/** Persisted catalog visible column selection (CDC §4.1.1). */

import {
  DEFAULT_VISIBLE_CATALOG_COLUMNS,
  ensureLockedColumns,
  parseAttrColumnKey,
} from "./catalog-column-registry";

export const CATALOG_VISIBLE_COLUMNS_KEY = "syskern:catalog-visible-columns:v2";
/** @deprecated migrated to CATALOG_VISIBLE_COLUMNS_KEY */
const LEGACY_ATTR_COLUMNS_KEY = "syskern:catalog-attr-columns:v1";

export function loadVisibleCatalogColumns(): string[] {
  if (typeof window === "undefined") return [...DEFAULT_VISIBLE_CATALOG_COLUMNS];
  try {
    const raw = window.localStorage.getItem(CATALOG_VISIBLE_COLUMNS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed) && parsed.every((k) => typeof k === "string")) {
        return ensureLockedColumns(parsed);
      }
    }
    // Migrate legacy attr-only storage
    const legacy = window.localStorage.getItem(LEGACY_ATTR_COLUMNS_KEY);
    if (legacy) {
      const attrCodes = JSON.parse(legacy) as unknown;
      if (Array.isArray(attrCodes)) {
        const attrs = attrCodes
          .filter((c): c is string => typeof c === "string")
          .map((c) => `attr:${c}`);
        return ensureLockedColumns([...DEFAULT_VISIBLE_CATALOG_COLUMNS, ...attrs]);
      }
    }
  } catch {
    /* ignore */
  }
  return [...DEFAULT_VISIBLE_CATALOG_COLUMNS];
}

export function saveVisibleCatalogColumns(keys: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      CATALOG_VISIBLE_COLUMNS_KEY,
      JSON.stringify(ensureLockedColumns(keys)),
    );
  } catch {
    /* storage unavailable */
  }
}

/** Attribute codes to request via ?attr_columns= for the list API. */
export function visibleAttrCodes(visibleKeys: string[]): string[] {
  return visibleKeys
    .map(parseAttrColumnKey)
    .filter((c): c is string => c != null);
}
