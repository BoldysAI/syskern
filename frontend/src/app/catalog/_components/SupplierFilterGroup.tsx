"use client";

import { useState } from "react";
import * as Collapsible from "@radix-ui/react-collapsible";
import { CaretDown, Star } from "@phosphor-icons/react";
import {
  CATALOG_NO_SUPPLIER_LABEL,
  CATALOG_NO_SUPPLIER_VALUE,
  type CatalogFilters,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { AppIcon } from "@/components/AppIcon";
import { FilterCheckboxGroup } from "@/components/FilterCheckboxGroup";

interface SupplierFilterGroupProps {
  filters: CatalogFilters;
  suppliers: string[];
  onPatch: (patch: Partial<CatalogFilters>) => void;
}

export function SupplierFilterGroup({ filters, suppliers, onPatch }: SupplierFilterGroupProps) {
  const [activeOpen, setActiveOpen] = useState(false);
  const activeSelected = filters.active_supplier ?? [];
  const hasActiveSelection = activeSelected.length > 0;
  const noSupplierOption = { value: CATALOG_NO_SUPPLIER_VALUE, label: CATALOG_NO_SUPPLIER_LABEL };
  const options = [noSupplierOption, ...suppliers.map((s) => ({ value: s, label: s }))];

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Toute source liée
        </p>
        <FilterCheckboxGroup
          options={options}
          selected={filters.supplier ?? []}
          onChange={(next) => onPatch({ supplier: next.length ? next : undefined })}
          searchable={suppliers.length > 5}
          idPrefix="supplier"
        />
      </div>

      <Collapsible.Root open={activeOpen} onOpenChange={setActiveOpen}>
        <div
          className={cn(
            "rounded-xl border bg-card/50 transition-colors",
            hasActiveSelection ? "border-primary/30 shadow-[var(--shadow-soft)]" : "border-border",
          )}
        >
          <Collapsible.Trigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-2 border-b border-border/60 bg-muted/30 px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
            >
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
                  hasActiveSelection
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground",
                )}
              >
                <AppIcon icon={Star} size="sm" weight="duotone" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-foreground">Fournisseur actif</p>
                {hasActiveSelection ? (
                  <p className="text-[11px] text-muted-foreground">
                    {activeSelected.length} sélectionné{activeSelected.length > 1 ? "s" : ""}
                  </p>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    Source active uniquement (colonne tableau)
                  </p>
                )}
              </div>
              <CaretDown
                size={14}
                className={cn(
                  "shrink-0 text-muted-foreground transition-transform duration-200",
                  activeOpen && "rotate-180",
                )}
              />
            </button>
          </Collapsible.Trigger>

          <Collapsible.Content
            className="p-2.5 data-[state=closed]:hidden"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground">
              Affine par la source marquée active sur chaque produit.
            </p>
            <FilterCheckboxGroup
              options={options}
              selected={activeSelected}
              onChange={(next) =>
                onPatch({ active_supplier: next.length ? next : undefined })
              }
              searchable={suppliers.length > 5}
              maxHeight="max-h-40"
              idPrefix="active-supplier"
            />
          </Collapsible.Content>
        </div>
      </Collapsible.Root>
    </div>
  );
}
