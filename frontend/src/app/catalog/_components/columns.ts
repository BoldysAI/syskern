// Available export columns — mirror of `_COLUMN_REGISTRY` in
// backend/apps/products/exports.py. Keep the keys in sync with the backend.

export interface ExportColumn {
  key: string;
  label: string;
}

export const EXPORT_COLUMNS: ExportColumn[] = [
  { key: "sku_code", label: "SKU" },
  { key: "name", label: "Nom" },
  { key: "universe", label: "Univers" },
  { key: "family", label: "Famille" },
  { key: "range", label: "Gamme" },
  { key: "sub_range", label: "Sous-gamme" },
  { key: "brand", label: "Marque" },
  { key: "active_supplier", label: "Fournisseur actif" },
  { key: "factory_code", label: "Code usine" },
  { key: "stock_quantity", label: "Stock (unités)" },
  { key: "pamp_eur", label: "PAMP (EUR)" },
  { key: "is_copper_indexed", label: "Indexé cuivre" },
  { key: "is_active", label: "Actif" },
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
