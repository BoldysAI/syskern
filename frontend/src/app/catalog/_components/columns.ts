// Available export columns — mirror of `_COLUMN_REGISTRY` in
// backend/apps/products/exports.py. Keep the keys in sync with the backend.

import type { MessageKey } from "@/lib/i18n";

export interface ExportColumn {
  key: string;
  labelKey: MessageKey;
}

export const EXPORT_COLUMNS: ExportColumn[] = [
  { key: "sku_code", labelKey: "catalog.column.sku" },
  { key: "name", labelKey: "catalog.field.name" },
  { key: "universe", labelKey: "catalog.column.universe" },
  { key: "family", labelKey: "catalog.column.family" },
  { key: "range", labelKey: "catalog.column.range" },
  { key: "sub_range", labelKey: "catalog.column.subRange" },
  { key: "brand", labelKey: "catalog.column.brand" },
  { key: "active_supplier", labelKey: "catalog.column.activeSupplier" },
  { key: "factory_code", labelKey: "catalog.column.factoryCode" },
  { key: "stock_quantity", labelKey: "catalog.column.stockUnits" },
  { key: "pamp_eur", labelKey: "catalog.column.pampEur" },
  { key: "is_copper_indexed", labelKey: "catalog.column.copperIndexed" },
  { key: "is_active", labelKey: "catalog.column.active" },
];

export const DEFAULT_EXPORT_COLUMNS: string[] = [
  "sku_code",
  "name",
  "universe",
  "family",
  "range",
  "sub_range",
  "brand",
  "active_supplier",
  "stock_quantity",
  "pamp_eur",
  "is_copper_indexed",
  "is_active",
];
