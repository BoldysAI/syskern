// Supplier list filters — same multi-checkbox style as the rest of the platform
// (catalog / offers / library). Never use dropdown FilterSelect bars for facets.

import type { MessageKey } from "@/lib/i18n";
import type { Supplier } from "@/lib/api";
import { INCOTERMS_FALLBACK } from "@/lib/incoterms";

type UiTranslate = (key: MessageKey, vars?: Record<string, string | number>) => string;

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
  { value: "active", labelKey: "suppliers.status.active" },
  { value: "inactive", labelKey: "suppliers.status.inactive" },
] as const satisfies readonly { value: string; labelKey: MessageKey }[];

export const SKUS_OPTIONS = [
  { value: "with", labelKey: "suppliers.filters.withLinkedSkus" },
  { value: "without", labelKey: "suppliers.filters.withoutLinkedSku" },
] as const satisfies readonly { value: string; labelKey: MessageKey }[];

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

function labelsForKeys(
  values: string[] | undefined,
  options: readonly { value: string; labelKey: MessageKey }[],
  t: UiTranslate,
): string {
  return (values ?? [])
    .map((v) => {
      const opt = options.find((o) => o.value === v);
      return opt ? t(opt.labelKey) : v;
    })
    .join(", ");
}

export function buildSupplierFilterChips(f: SupplierFilters, t: UiTranslate): SupplierFilterChip[] {
  const chips: SupplierFilterChip[] = [];
  if (f.q?.trim())
    chips.push({ id: "q", category: t("suppliers.filters.chip.search"), label: f.q.trim() });
  if (f.currency?.length)
    chips.push({
      id: "currency",
      category: t("suppliers.column.currency"),
      label: labelsFor(f.currency, CURRENCY_OPTIONS),
    });
  if (f.incoterm?.length)
    chips.push({
      id: "incoterm",
      category: t("suppliers.column.incoterm"),
      label: labelsFor(f.incoterm, INCOTERM_OPTIONS),
    });
  if (f.status?.length)
    chips.push({
      id: "status",
      category: t("suppliers.column.status"),
      label: labelsForKeys(f.status, STATUS_OPTIONS, t),
    });
  if (f.skus?.length)
    chips.push({
      id: "skus",
      category: t("suppliers.column.linkedSkus"),
      label: labelsForKeys(f.skus, SKUS_OPTIONS, t),
    });
  return chips;
}

export function removeSupplierFilterChip(f: SupplierFilters, chipId: string): SupplierFilters {
  return { ...f, [chipId]: undefined };
}
