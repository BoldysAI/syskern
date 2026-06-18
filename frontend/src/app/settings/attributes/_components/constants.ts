import type { AttributeCategory, AttributeDataType } from "@/lib/api";

/** Fixed attribute categories (CDC §4.5) with French labels. */
export const CATEGORIES: { id: AttributeCategory; label: string }[] = [
  { id: "structural", label: "Structurel" },
  { id: "technical", label: "Technique" },
  { id: "marketing", label: "Marketing" },
  { id: "commercial", label: "Commercial" },
  { id: "logistic", label: "Logistique" },
];

/** Supported attribute data types (CDC §4.5) with French labels. */
export const DATA_TYPES: { id: AttributeDataType; label: string }[] = [
  { id: "text", label: "Texte" },
  { id: "number", label: "Nombre" },
  { id: "boolean", label: "Booléen" },
  { id: "date", label: "Date" },
  { id: "select", label: "Choix unique" },
  { id: "multiselect", label: "Choix multiple" },
];

export const CATEGORY_LABELS: Record<AttributeCategory, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c.label])
) as Record<AttributeCategory, string>;

export const DATA_TYPE_LABELS: Record<AttributeDataType, string> = Object.fromEntries(
  DATA_TYPES.map((d) => [d.id, d.label])
) as Record<AttributeDataType, string>;

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
