import type { AttributeCategory, AttributeDataType } from "@/lib/api";

/** Fixed attribute categories (CDC §4.5). Labels live in the settings catalog. */
export const CATEGORIES = [
  { id: "structural", labelKey: "settings.attributes.category.structural" },
  { id: "technical", labelKey: "settings.attributes.category.technical" },
  { id: "marketing", labelKey: "settings.attributes.category.marketing" },
  { id: "commercial", labelKey: "settings.attributes.category.commercial" },
  { id: "logistic", labelKey: "settings.attributes.category.logistic" },
] as const satisfies ReadonlyArray<{ id: AttributeCategory; labelKey: string }>;

/** Supported attribute data types (CDC §4.5). Labels live in the settings catalog. */
export const DATA_TYPES = [
  { id: "text", labelKey: "settings.attributes.type.text" },
  { id: "number", labelKey: "settings.attributes.type.number" },
  { id: "boolean", labelKey: "settings.attributes.type.boolean" },
  { id: "date", labelKey: "settings.attributes.type.date" },
  { id: "select", labelKey: "settings.attributes.type.select" },
  { id: "multiselect", labelKey: "settings.attributes.type.multiselect" },
] as const satisfies ReadonlyArray<{ id: AttributeDataType; labelKey: string }>;

export const CATEGORY_LABELS = {
  structural: "settings.attributes.category.structural",
  technical: "settings.attributes.category.technical",
  marketing: "settings.attributes.category.marketing",
  commercial: "settings.attributes.category.commercial",
  logistic: "settings.attributes.category.logistic",
} as const satisfies Record<AttributeCategory, string>;

export const DATA_TYPE_LABELS = {
  text: "settings.attributes.type.text",
  number: "settings.attributes.type.number",
  boolean: "settings.attributes.type.boolean",
  date: "settings.attributes.type.date",
  select: "settings.attributes.type.select",
  multiselect: "settings.attributes.type.multiselect",
} as const satisfies Record<AttributeDataType, string>;

/** Code regex enforced server-side (CDC §4.5): snake_case starting with a letter. */
export const CODE_REGEX = /^[a-z][a-z0-9_]*$/;

/**
 * Derive a snake_case `code` from a French label.
 * Strips accents, lowercases, collapses non-alphanumerics to `_`, and ensures
 * the result starts with a letter (matching CODE_REGEX).
 */
export function slugifyCode(label: string): string {
  let s = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (s && !/^[a-z]/.test(s)) s = `attr_${s}`;
  return s;
}
