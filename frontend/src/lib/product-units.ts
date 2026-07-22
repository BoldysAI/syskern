/**
 * Libellé d'unité affichable pour un produit (FEEDBACK 2 — PIM).
 *
 * Le client veut voir l'unité réelle du produit à côté des valeurs de stock
 * (ex. « 233 KM » pour une bobine de câble) plutôt que le générique « u ».
 * `uom` vient d'Odoo et fait foi ; `base_unit` est le fallback interne.
 */

const BASE_UNIT_LABELS: Record<string, string> = {
  unit: "u",
  km: "km",
  m: "m",
};

export function productUnitLabel(product: {
  uom?: string | null;
  base_unit?: string | null;
}): string {
  const uom = product.uom?.trim();
  if (uom) return uom;
  const base = product.base_unit?.trim().toLowerCase();
  return (base && BASE_UNIT_LABELS[base]) || "u";
}
