// Document library list filters — mirrors the offers/simulations modules (CDC §7.4).

import type { MessageKey } from "@/lib/i18n";

export interface LibraryFilters {
  category?: string[];
  language?: string[];
}

export const CATEGORY_OPTIONS: { value: string; labelKey: MessageKey }[] = [
  { value: "cgv", labelKey: "library.category.cgv" },
  { value: "warranty", labelKey: "library.category.warranty" },
  { value: "quality", labelKey: "library.category.quality" },
  { value: "project_reference", labelKey: "library.category.project_reference" },
  { value: "company", labelKey: "library.category.company" },
  { value: "other", labelKey: "library.category.other" },
];

export const LANGUAGE_OPTIONS: { value: string; labelKey: MessageKey }[] = [
  { value: "fr", labelKey: "library.language.fr" },
  { value: "en", labelKey: "library.language.en" },
  { value: "es", labelKey: "library.language.es" },
];

type TranslateFn = (key: MessageKey, vars?: Record<string, string | number>) => string;

export function translateOptionLabel(
  options: readonly { value: string; labelKey: MessageKey }[],
  value: string,
  t: TranslateFn,
): string {
  const match = options.find((option) => option.value === value);
  return match ? t(match.labelKey) : value;
}

export function countActiveLibraryFilters(filters: LibraryFilters): number {
  let n = 0;
  if (filters.category?.length) n += 1;
  if (filters.language?.length) n += 1;
  return n;
}

export function isEmptyLibraryFilter(filters: LibraryFilters): boolean {
  return countActiveLibraryFilters(filters) === 0;
}

/** Serialize into the `/api/document-library/` query string. */
export function buildLibraryQuery(
  filters: LibraryFilters,
  extra: { limit?: number; offset?: number; ordering?: string } = {},
): string {
  const p = new URLSearchParams();
  if (extra.limit != null) p.set("limit", String(extra.limit));
  if (extra.offset != null) p.set("offset", String(extra.offset));
  if (extra.ordering) p.set("ordering", extra.ordering);
  if (filters.category?.length) p.set("category", filters.category.join(","));
  if (filters.language?.length) p.set("language", filters.language.join(","));
  return p.toString();
}

export interface LibraryFilterChip {
  id: string;
  category: string;
  label: string;
}

export function buildLibraryFilterChips(
  filters: LibraryFilters,
  t: TranslateFn,
): LibraryFilterChip[] {
  const chips: LibraryFilterChip[] = [];
  if (filters.category?.length)
    chips.push({
      id: "category",
      category: t("library.category"),
      label: filters.category
        .map((c) => translateOptionLabel(CATEGORY_OPTIONS, c, t))
        .join(", "),
    });
  if (filters.language?.length)
    chips.push({
      id: "language",
      category: t("library.language"),
      label: filters.language
        .map((l) => translateOptionLabel(LANGUAGE_OPTIONS, l, t))
        .join(", "),
    });
  return chips;
}

export function removeLibraryFilterChip(filters: LibraryFilters, chipId: string): LibraryFilters {
  switch (chipId) {
    case "category":
      return { ...filters, category: undefined };
    case "language":
      return { ...filters, language: undefined };
    default:
      return filters;
  }
}

export function normalizeLibraryFilters(filters: LibraryFilters): LibraryFilters {
  const toArray = (value: unknown): string[] | undefined => {
    if (Array.isArray(value)) return value.length ? (value as string[]) : undefined;
    if (typeof value === "string" && value) return [value];
    return undefined;
  };
  const raw = filters as LibraryFilters & Record<string, unknown>;
  return { category: toArray(raw.category), language: toArray(raw.language) };
}
