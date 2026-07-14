"use client";

import { CurrencyDollar, MapPinLine, SealCheck, Truck } from "@phosphor-icons/react";
import { FilterSection } from "@/components/FilterSection";
import { FilterCheckboxGroup } from "@/components/FilterCheckboxGroup";
import { cn } from "@/lib/utils";
import {
  CURRENCY_OPTIONS,
  INCOTERM_OPTIONS,
  SKUS_OPTIONS,
  STATUS_OPTIONS,
  type SupplierFilters,
} from "./supplier-filters";

interface Props {
  filters: SupplierFilters;
  onChange: (next: SupplierFilters) => void;
  className?: string;
}

export function SuppliersFiltersSidebar({ filters, onChange, className }: Props) {
  const patch = (p: Partial<SupplierFilters>) => onChange({ ...filters, ...p });

  return (
    <div className={cn("flex flex-col gap-1 p-4", className)}>
      <FilterSection title="Devise" icon={CurrencyDollar} activeCount={filters.currency?.length ?? 0}>
        <FilterCheckboxGroup
          idPrefix="sup-currency"
          options={CURRENCY_OPTIONS}
          selected={filters.currency ?? []}
          onChange={(v) => patch({ currency: v.length ? v : undefined })}
        />
      </FilterSection>

      <FilterSection title="Incoterm" icon={MapPinLine} activeCount={filters.incoterm?.length ?? 0}>
        <FilterCheckboxGroup
          idPrefix="sup-incoterm"
          options={INCOTERM_OPTIONS}
          selected={filters.incoterm ?? []}
          onChange={(v) => patch({ incoterm: v.length ? v : undefined })}
          searchable
        />
      </FilterSection>

      <FilterSection title="Statut" icon={SealCheck} activeCount={filters.status?.length ?? 0}>
        <FilterCheckboxGroup
          idPrefix="sup-status"
          options={STATUS_OPTIONS}
          selected={filters.status ?? []}
          onChange={(v) => patch({ status: v.length ? v : undefined })}
        />
      </FilterSection>

      <FilterSection title="SKU liés" icon={Truck} activeCount={filters.skus?.length ?? 0}>
        <FilterCheckboxGroup
          idPrefix="sup-skus"
          options={SKUS_OPTIONS}
          selected={filters.skus ?? []}
          onChange={(v) => patch({ skus: v.length ? v : undefined })}
        />
      </FilterSection>
    </div>
  );
}
