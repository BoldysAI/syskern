// Supplier list filters — same multi-checkbox style as the rest of the platform
// (catalog / offers / library). Never use dropdown FilterSelect bars for facets.

import type { Supplier } from "@/lib/api";
import { INCOTERMS_FALLBACK } from "@/lib/incoterms";

export interface SupplierFilters {
  q?: string;
  currency?: string[];
  incoterm?: string[];
  status?: string[]; // "active" | "inactive"
  skus?: string[]; // "with" | "without"
}

export const CURRENCY_OPTIONS = [
  { value: "EUR", label: "EUR" },
  { value: "USD", label: "USD" },
  { value: "RMB", label: "RMB" },
];

export const INCOTERM_OPTIONS = INCOTERMS_FALLBACK.map((i) => ({ value: i.code, label: i.code }));

export const STATUS_OPTIONS = [
  { value: "active", label: "Actif" },
  { value: "inactive", label: "Inactif" },
];

export const SKUS_OPTIONS = [
  { value: "with", label: "Avec SKU liés" },
  { value: "without", label: "Sans SKU lié" },
];

export function countActiveSupplierFilters(f: SupplierFilters): number {
  let n = 0;
  if (f.q?.trim()) n += 1;
  if (f.currency?.length) n += 1;
  if (f.incoterm?.length) n += 1;
  if (f.status?.length) n += 1;
  if (f.skus?.length) n += 1;
  return n;
}

export function isEmptySupplierFilter(f: SupplierFilters): boolean {
  return countActiveSupplierFilters(f) === 0;
}

export function applySupplierFilters(rows: Supplier[], f: SupplierFilters): Supplier[] {
  let out = rows;
  const q = f.q?.trim().toLowerCase();
  if (q) {
    out = out.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.code.toLowerCase().includes(q) ||
        (s.location || "").toLowerCase().includes(q),
    );
  }
  if (f.currency?.length) out = out.filter((s) => f.currency!.includes(s.currency_default));
  if (f.incoterm?.length)
    out = out.filter((s) => s.incoterm_default && f.incoterm!.includes(s.incoterm_default));
  if (f.status?.length) {
    out = out.filter((s) => f.status!.includes(s.is_active ? "active" : "inactive"));
  }
  if (f.skus?.length && f.skus.length === 1) {
    const wantWith = f.skus[0] === "with";
    out = out.filter((s) => (s.linked_skus_count ?? 0) > 0 === wantWith);
  }
  return out;
}

export interface SupplierFilterChip {
  id: string;
  category: string;
  label: string;
}

function labelsFor(values: string[] | undefined, options: { value: string; label: string }[]): string {
  return (values ?? []).map((v) => options.find((o) => o.value === v)?.label ?? v).join(", ");
}

export function buildSupplierFilterChips(f: SupplierFilters): SupplierFilterChip[] {
  const chips: SupplierFilterChip[] = [];
  if (f.q?.trim()) chips.push({ id: "q", category: "Recherche", label: f.q.trim() });
  if (f.currency?.length)
    chips.push({ id: "currency", category: "Devise", label: labelsFor(f.currency, CURRENCY_OPTIONS) });
  if (f.incoterm?.length)
    chips.push({ id: "incoterm", category: "Incoterm", label: labelsFor(f.incoterm, INCOTERM_OPTIONS) });
  if (f.status?.length)
    chips.push({ id: "status", category: "Statut", label: labelsFor(f.status, STATUS_OPTIONS) });
  if (f.skus?.length)
    chips.push({ id: "skus", category: "SKU liés", label: labelsFor(f.skus, SKUS_OPTIONS) });
  return chips;
}

export function removeSupplierFilterChip(f: SupplierFilters, chipId: string): SupplierFilters {
  return { ...f, [chipId]: undefined };
}
