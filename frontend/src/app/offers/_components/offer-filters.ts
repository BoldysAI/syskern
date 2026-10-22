// Offer list filters — mirrors the simulations module (CDC §7.5).

import type { MessageKey } from "@/lib/i18n";

export type OfferType = "tariff" | "project";
export type OfferStatus = "draft" | "sent" | "won" | "lost" | "expired";
export type OfferGeneration = "pending" | "generating" | "ready" | "error";

export interface OfferFilters {
  q?: string;
  offer_type?: OfferType[];
  status?: OfferStatus[];
  generation_status?: OfferGeneration[];
}

export const OFFER_TYPE_OPTIONS = [
  { value: "tariff", labelKey: "offers.type.tariff" },
  { value: "project", labelKey: "offers.type.project" },
] as const satisfies readonly { value: OfferType; labelKey: MessageKey }[];

export const OFFER_STATUS_OPTIONS = [
  { value: "draft", labelKey: "offers.status.draft" },
  { value: "sent", labelKey: "offers.status.sent" },
  { value: "won", labelKey: "offers.status.won" },
  { value: "lost", labelKey: "offers.status.lost" },
  { value: "expired", labelKey: "offers.status.expired" },
] as const satisfies readonly { value: OfferStatus; labelKey: MessageKey }[];

export const OFFER_GENERATION_OPTIONS = [
  { value: "ready", labelKey: "offers.generation.ready" },
  { value: "generating", labelKey: "offers.generation.generating" },
  { value: "pending", labelKey: "offers.generation.waiting" },
  { value: "error", labelKey: "offers.generation.error" },
] as const satisfies readonly { value: OfferGeneration; labelKey: MessageKey }[];

export function countActiveOfferFilters(filters: OfferFilters): number {
  let n = 0;
  if (filters.q?.trim()) n += 1;
  if (filters.offer_type?.length) n += 1;
  if (filters.status?.length) n += 1;
  if (filters.generation_status?.length) n += 1;
  return n;
}

export function isEmptyOfferFilter(filters: OfferFilters): boolean {
  return countActiveOfferFilters(filters) === 0;
}

/** Serialize the active filters into the `/api/offers/` query string. */
export function buildOfferQuery(
  filters: OfferFilters,
  extra: { ordering?: string; limit?: number; offset?: number } = {},
): string {
  const p = new URLSearchParams();
  if (extra.ordering) p.set("ordering", extra.ordering);
  if (extra.limit != null) p.set("limit", String(extra.limit));
  if (extra.offset != null) p.set("offset", String(extra.offset));
  if (filters.q?.trim()) p.set("q", filters.q.trim());
  if (filters.offer_type?.length) p.set("offer_type", filters.offer_type.join(","));
  if (filters.status?.length) p.set("status", filters.status.join(","));
  if (filters.generation_status?.length)
    p.set("generation_status", filters.generation_status.join(","));
  return p.toString();
}

export interface OfferFilterChip {
  id: string;
  category: string;
  label: string;
}

type UiTranslate = (key: MessageKey, vars?: Record<string, string | number>) => string;

function labelsFor<T extends string>(
  values: T[] | undefined,
  options: readonly { value: T; labelKey: MessageKey }[],
  t: UiTranslate,
): string {
  return (values ?? [])
    .map((v) => {
      const opt = options.find((o) => o.value === v);
      return opt ? t(opt.labelKey) : v;
    })
    .join(", ");
}

export function buildOfferFilterChips(filters: OfferFilters, t: UiTranslate): OfferFilterChip[] {
  const chips: OfferFilterChip[] = [];
  if (filters.q?.trim())
    chips.push({ id: "q", category: t("offers.filters.chip.search"), label: filters.q.trim() });
  if (filters.offer_type?.length)
    chips.push({
      id: "offer_type",
      category: t("offers.field.type"),
      label: labelsFor(filters.offer_type, OFFER_TYPE_OPTIONS, t),
    });
  if (filters.status?.length)
    chips.push({
      id: "status",
      category: t("offers.field.status"),
      label: labelsFor(filters.status, OFFER_STATUS_OPTIONS, t),
    });
  if (filters.generation_status?.length)
    chips.push({
      id: "generation_status",
      category: t("offers.field.document"),
      label: labelsFor(filters.generation_status, OFFER_GENERATION_OPTIONS, t),
    });
  return chips;
}

export function removeOfferFilterChip(filters: OfferFilters, chipId: string): OfferFilters {
  switch (chipId) {
    case "q":
      return { ...filters, q: undefined };
    case "offer_type":
      return { ...filters, offer_type: undefined };
    case "status":
      return { ...filters, status: undefined };
    case "generation_status":
      return { ...filters, generation_status: undefined };
    default:
      return filters;
  }
}

/** Coerce legacy/string-shaped saved filters into the `string[]` shape. */
export function normalizeOfferFilters(filters: OfferFilters): OfferFilters {
  const toArray = <T extends string>(value: unknown): T[] | undefined => {
    if (Array.isArray(value)) return value.length ? (value as T[]) : undefined;
    if (typeof value === "string" && value) return [value as T];
    return undefined;
  };
  const raw = filters as OfferFilters & Record<string, unknown>;
  return {
    q: typeof raw.q === "string" ? raw.q : undefined,
    offer_type: toArray<OfferType>(raw.offer_type),
    status: toArray<OfferStatus>(raw.status),
    generation_status: toArray<OfferGeneration>(raw.generation_status),
  };
}
