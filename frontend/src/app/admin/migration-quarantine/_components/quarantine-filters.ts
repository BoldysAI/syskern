import type { MessageKey } from "@/lib/i18n";

// Quarantine list filters — mirrors the offers/simulations modules (CDC §8.7).

export type ResolvedFilter = "true" | "false";

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

const REASON_LABEL_KEYS = {
  no_sku: "admin.quarantine.reasonNoSku",
  no_match: "admin.quarantine.reasonNoMatch",
  duplicate_match: "admin.quarantine.reasonDuplicate",
  invalid_format: "admin.quarantine.reasonInvalidFormat",
  missing_required_field: "admin.quarantine.reasonMissingField",
} as const satisfies Record<string, MessageKey>;

export function reasonLabel(reason: string, t: Translate): string {
  const key = REASON_LABEL_KEYS[reason as keyof typeof REASON_LABEL_KEYS];
  return key ? t(key) : reason;
}

export function reasonOptions(t: Translate): { value: string; label: string }[] {
  return Object.entries(REASON_LABEL_KEYS).map(([value, key]) => ({
    value,
    label: t(key),
  }));
}

export function resolvedOptions(t: Translate): { value: ResolvedFilter; label: string }[] {
  return [
    { value: "false", label: t("admin.quarantine.toProcess") },
    { value: "true", label: t("admin.quarantine.resolvedPlural") },
  ];
}

export interface QuarantineFilters {
  source_file?: string[];
  reason?: string[];
  resolved?: ResolvedFilter;
}

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

export function buildQuarantineFilterChips(
  filters: QuarantineFilters,
  t: Translate,
): QuarantineFilterChip[] {
  const chips: QuarantineFilterChip[] = [];
  if (filters.source_file?.length)
    chips.push({
      id: "source_file",
      category: t("admin.quarantine.chipFile"),
      label: filters.source_file.join(", "),
    });
  if (filters.reason?.length)
    chips.push({
      id: "reason",
      category: t("admin.quarantine.motif"),
      label: filters.reason.map((r) => reasonLabel(r, t)).join(", "),
    });
  if (filters.resolved)
    chips.push({
      id: "resolved",
      category: t("admin.quarantine.status"),
      label:
        resolvedOptions(t).find((o) => o.value === filters.resolved)?.label ?? filters.resolved,
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
