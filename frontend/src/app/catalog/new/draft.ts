// Shared draft model for the product-creation wizard (`/catalog/new`).
//
// Single source of truth for the localStorage draft key + shape, so the wizard
// (restore/persist) and the "Dupliquer" action (seed a pre-filled draft from an
// existing product) can never diverge on the key or field mapping.

import type { ProductAttributeValue, ProductDetail, ProductSupplier } from "@/lib/api";

export const DRAFT_KEY = "syskern:new-product-draft:v1";

export type Core = Record<string, unknown>;

export interface WizardDraft {
  core: Core;
  attrs: Record<string, unknown>;
  suppliers: ProductSupplier[];
  fullForm: boolean;
}

export function emptyDraft(): WizardDraft {
  return {
    core: { base_unit: "unit", supply_policy: "buy", is_stockable: true, is_copper_indexed: false },
    attrs: {},
    suppliers: [],
    fullForm: false,
  };
}

export function loadDraft(): WizardDraft {
  if (typeof window === "undefined") return emptyDraft();
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return emptyDraft();
    const parsed = JSON.parse(raw) as Partial<WizardDraft> & { step?: number };
    // `step` was persisted in v1 drafts — intentionally not restored (always start at Identification).
    return {
      ...emptyDraft(),
      core: parsed.core ?? emptyDraft().core,
      attrs: parsed.attrs ?? {},
      suppliers: parsed.suppliers ?? [],
      fullForm: parsed.fullForm ?? false,
    };
  } catch {
    return emptyDraft();
  }
}

/** Persist a draft into localStorage (used to seed a duplication before navigating). */
export function seedProductDraft(draft: WizardDraft): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* storage unavailable — ignore */
  }
}

// Core fields copied verbatim from the source product (must stay a subset of the
// wizard's `buildPayload` passthrough so nothing is pre-filled that can't be saved).
const DUPLICATE_CORE_KEYS = [
  "name",
  "parent_reference",
  "factory_code",
  "item_code",
  "brand",
  "universe",
  "family",
  "range",
  "sub_range",
  "gtin",
  "hs_code",
  "dop_number",
  "base_unit",
  "supply_policy",
  "unit_weight_kg",
  "copper_weight_kg_per_unit",
  "primary_packaging_qty",
  "secondary_packaging_qty",
  "tertiary_packaging_qty",
  "pallet_qty",
] as const;

/**
 * Build a wizard draft pre-filled from an existing product (FEEDBACK 1).
 *
 * Copies hierarchy, brand, multilingual descriptions, logistics/technical core
 * fields and every dynamic attribute value. Deliberately does NOT copy the SKU
 * (unique + immutable — left empty & required), price history, or the active
 * supplier (validated by Yassine: a duplicate starts with no supplier).
 */
export function buildDuplicateDraft(
  product: ProductDetail,
  attrValues: ProductAttributeValue[],
): WizardDraft {
  const src = product as unknown as Record<string, unknown>;
  const core: Core = { ...emptyDraft().core };

  for (const k of DUPLICATE_CORE_KEYS) {
    const v = src[k];
    if (v != null && v !== "") core[k] = v;
  }
  core.description_marketing = src.description_marketing ?? {};
  core.is_stockable = src.is_stockable === true;
  core.is_copper_indexed = src.is_copper_indexed === true;
  core.sku_code = ""; // SKU vidé et obligatoire (unique, immuable après création)

  const attrs: Record<string, unknown> = {};
  for (const av of attrValues) {
    if (av?.attribute != null) attrs[av.attribute] = av.value;
  }

  return { core, attrs, suppliers: [], fullForm: true };
}
