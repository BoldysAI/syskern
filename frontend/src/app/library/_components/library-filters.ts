// Document library list filters — mirrors the offers/simulations modules (CDC §7.4).

export interface LibraryFilters {
  category?: string[];
  language?: string[];
}

export const CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: "cgv", label: "CGV" },
  { value: "warranty", label: "Garantie" },
  { value: "quality", label: "Qualité" },
  { value: "project_reference", label: "Références projet" },
  { value: "company", label: "Entreprise" },
  { value: "other", label: "Autre" },
];

export const LANGUAGE_OPTIONS: { value: string; label: string }[] = [
  { value: "fr", label: "Français" },
  { value: "en", label: "Anglais" },
  { value: "es", label: "Espagnol" },
];

const CATEGORY_LABEL = Object.fromEntries(CATEGORY_OPTIONS.map((o) => [o.value, o.label]));
const LANGUAGE_LABEL = Object.fromEntries(LANGUAGE_OPTIONS.map((o) => [o.value, o.label]));

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

export function buildLibraryFilterChips(filters: LibraryFilters): LibraryFilterChip[] {
  const chips: LibraryFilterChip[] = [];
  if (filters.category?.length)
    chips.push({
      id: "category",
      category: "Catégorie",
      label: filters.category.map((c) => CATEGORY_LABEL[c] ?? c).join(", "),
    });
  if (filters.language?.length)
    chips.push({
      id: "language",
      category: "Langue",
      label: filters.language.map((l) => LANGUAGE_LABEL[l] ?? l).join(", "),
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
