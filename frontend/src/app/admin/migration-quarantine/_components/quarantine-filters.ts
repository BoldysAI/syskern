// Quarantine list filters — mirrors the offers/simulations modules (CDC §8.7).

export type ResolvedFilter = "true" | "false";

export interface QuarantineFilters {
  source_file?: string[];
  reason?: string[];
  resolved?: ResolvedFilter;
}

export const REASON_LABELS: Record<string, string> = {
  no_sku: "SKU manquant",
  no_match: "Aucune correspondance",
  duplicate_match: "Correspondances multiples",
  invalid_format: "Format invalide",
  missing_required_field: "Champ requis manquant",
};

export const REASON_OPTIONS = Object.entries(REASON_LABELS).map(([value, label]) => ({
  value,
  label,
}));

export const RESOLVED_OPTIONS: { value: ResolvedFilter; label: string }[] = [
  { value: "false", label: "À traiter" },
  { value: "true", label: "Résolues" },
];

export function countActiveQuarantineFilters(filters: QuarantineFilters): number {
  let n = 0;
  if (filters.source_file?.length) n += 1;
  if (filters.reason?.length) n += 1;
  if (filters.resolved) n += 1;
  return n;
}

export function isEmptyQuarantineFilter(filters: QuarantineFilters): boolean {
  return countActiveQuarantineFilters(filters) === 0;
}

/** Serialize into the `/api/migration/unmatched/` query string. */
export function buildQuarantineQuery(
  filters: QuarantineFilters,
  extra: { limit?: number; offset?: number; ordering?: string } = {},
): string {
  const p = new URLSearchParams();
  if (extra.limit != null) p.set("limit", String(extra.limit));
  if (extra.offset != null) p.set("offset", String(extra.offset));
  if (extra.ordering) p.set("ordering", extra.ordering);
  if (filters.source_file?.length) p.set("source_file", filters.source_file.join(","));
  if (filters.reason?.length) p.set("reason", filters.reason.join(","));
  if (filters.resolved) p.set("resolved", filters.resolved);
  return p.toString();
}

export interface QuarantineFilterChip {
  id: string;
  category: string;
  label: string;
}

export function buildQuarantineFilterChips(filters: QuarantineFilters): QuarantineFilterChip[] {
  const chips: QuarantineFilterChip[] = [];
  if (filters.source_file?.length)
    chips.push({ id: "source_file", category: "Fichier", label: filters.source_file.join(", ") });
  if (filters.reason?.length)
    chips.push({
      id: "reason",
      category: "Motif",
      label: filters.reason.map((r) => REASON_LABELS[r] ?? r).join(", "),
    });
  if (filters.resolved)
    chips.push({
      id: "resolved",
      category: "Statut",
      label: RESOLVED_OPTIONS.find((o) => o.value === filters.resolved)?.label ?? filters.resolved,
    });
  return chips;
}

export function removeQuarantineFilterChip(
  filters: QuarantineFilters,
  chipId: string,
): QuarantineFilters {
  switch (chipId) {
    case "source_file":
      return { ...filters, source_file: undefined };
    case "reason":
      return { ...filters, reason: undefined };
    case "resolved":
      return { ...filters, resolved: undefined };
    default:
      return filters;
  }
}

export function normalizeQuarantineFilters(filters: QuarantineFilters): QuarantineFilters {
  const toArray = (value: unknown): string[] | undefined => {
    if (Array.isArray(value)) return value.length ? (value as string[]) : undefined;
    if (typeof value === "string" && value) return [value];
    return undefined;
  };
  const raw = filters as QuarantineFilters & Record<string, unknown>;
  const resolved = raw.resolved === "true" || raw.resolved === "false" ? raw.resolved : undefined;
  return {
    source_file: toArray(raw.source_file),
    reason: toArray(raw.reason),
    resolved,
  };
}
