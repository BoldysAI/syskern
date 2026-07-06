// Offer list filters — mirrors the simulations module (CDC §7.5).

export type OfferType = "tariff" | "project";
export type OfferStatus = "draft" | "sent" | "won" | "lost" | "expired";
export type OfferGeneration = "pending" | "generating" | "ready" | "error";

export interface OfferFilters {
  q?: string;
  offer_type?: OfferType[];
  status?: OfferStatus[];
  generation_status?: OfferGeneration[];
}

export const OFFER_TYPE_OPTIONS: { value: OfferType; label: string }[] = [
  { value: "tariff", label: "Tarif" },
  { value: "project", label: "Projet" },
];

export const OFFER_STATUS_OPTIONS: { value: OfferStatus; label: string }[] = [
  { value: "draft", label: "Brouillon" },
  { value: "sent", label: "Envoyée" },
  { value: "won", label: "Gagnée" },
  { value: "lost", label: "Perdue" },
  { value: "expired", label: "Expirée" },
];

export const OFFER_GENERATION_OPTIONS: { value: OfferGeneration; label: string }[] = [
  { value: "ready", label: "Prête" },
  { value: "generating", label: "En génération" },
  { value: "pending", label: "En attente" },
  { value: "error", label: "En erreur" },
];

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
  extra: { ordering?: string; limit?: number } = {},
): string {
  const p = new URLSearchParams();
  if (extra.ordering) p.set("ordering", extra.ordering);
  if (extra.limit != null) p.set("limit", String(extra.limit));
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

function labelsFor<T extends string>(
  values: T[] | undefined,
  options: { value: T; label: string }[],
): string {
  return (values ?? []).map((v) => options.find((o) => o.value === v)?.label ?? v).join(", ");
}

export function buildOfferFilterChips(filters: OfferFilters): OfferFilterChip[] {
  const chips: OfferFilterChip[] = [];
  if (filters.q?.trim()) chips.push({ id: "q", category: "Recherche", label: filters.q.trim() });
  if (filters.offer_type?.length)
    chips.push({
      id: "offer_type",
      category: "Type",
      label: labelsFor(filters.offer_type, OFFER_TYPE_OPTIONS),
    });
  if (filters.status?.length)
    chips.push({
      id: "status",
      category: "Statut",
      label: labelsFor(filters.status, OFFER_STATUS_OPTIONS),
    });
  if (filters.generation_status?.length)
    chips.push({
      id: "generation_status",
      category: "Document",
      label: labelsFor(filters.generation_status, OFFER_GENERATION_OPTIONS),
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
