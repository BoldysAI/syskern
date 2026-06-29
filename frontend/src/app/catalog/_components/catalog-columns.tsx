"use client";

import Link from "next/link";
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { StatusBadge, universeBadgeVariant } from "@/components/StatusBadge";
import type { Product } from "@/lib/api";
import type { DataTableColumnDef } from "@/components/data-table";

export function parseDec(v?: string | null): number {
  return v != null ? parseFloat(v) : 0;
}

function UniverseBadge({ universe }: { universe: string }) {
  if (!universe) return <span className="text-muted-foreground/50">—</span>;
  return <StatusBadge variant={universeBadgeVariant(universe)}>{universe}</StatusBadge>;
}

export interface UseCatalogColumnsOptions {
  /** Lien vers la fiche produit (page catalogue). Désactivé en mode sélection embarqué. */
  skuAsLink?: boolean;
  /** Colonnes supplémentaires (ex. « Déjà ajouté » dans une modale). */
  extraColumns?: DataTableColumnDef<Product>[];
}

/** Colonnes du tableau catalogue — source unique pour toutes les vues catalogue. */
export function useCatalogColumns({
  skuAsLink = true,
  extraColumns = [],
}: UseCatalogColumnsOptions = {}) {
  return useMemo<DataTableColumnDef<Product>[]>(
    () => [
      {
        key: "sku_code",
        label: "SKU",
        sortField: "sku_code",
        width: 160,
        render: (product) =>
          skuAsLink ? (
            <Link
              href={`/catalog/${encodeURIComponent(product.sku_code)}`}
              className="font-mono text-sm font-semibold text-primary hover:text-primary/80 hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {product.sku_code}
            </Link>
          ) : (
            <span className="font-mono text-sm font-semibold text-foreground">{product.sku_code}</span>
          ),
      },
      {
        key: "name",
        label: "Désignation",
        sortField: "name",
        width: 280,
        cellClassName: "text-sm text-muted-foreground truncate",
        render: (product) => product.name,
      },
      {
        key: "universe",
        label: "Univers",
        sortField: "universe",
        width: 160,
        render: (product) => <UniverseBadge universe={product.universe} />,
      },
      {
        key: "family",
        label: "Famille",
        sortField: "family",
        width: 150,
        cellClassName: "text-sm text-muted-foreground truncate",
        render: (product) => product.family || "—",
      },
      {
        key: "active_supplier",
        label: "Fournisseur actif",
        width: 170,
        cellClassName: "text-sm text-muted-foreground truncate",
        render: (product) => product.active_supplier || "—",
      },
      {
        key: "pamp_eur",
        label: "PAMP",
        sortField: "pamp_eur",
        width: 120,
        align: "right",
        cellClassName: "text-sm font-medium tabular-nums text-primary",
        render: (product) => {
          const pamp = parseDec(product.pamp_eur);
          return pamp > 0
            ? `${pamp.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
            : "—";
        },
      },
      {
        key: "stock_quantity",
        label: "Stock",
        sortField: "stock_quantity",
        width: 100,
        render: (product) => {
          const stock = parseDec(product.stock_quantity);
          return (
            <span
              className={cn(
                "inline-flex items-center gap-1 text-sm font-medium",
                stock > 0 ? "text-brand-green" : "text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  stock > 0 ? "bg-brand-green" : "bg-muted-foreground/40",
                )}
              />
              {Math.round(stock)}
            </span>
          );
        },
      },
      {
        key: "is_active",
        label: "Actif",
        width: 80,
        render: (product) => (
          <StatusBadge variant={product.is_active ? "success" : "draft"}>
            {product.is_active ? "Oui" : "Non"}
          </StatusBadge>
        ),
      },
      ...extraColumns,
    ],
    [skuAsLink, extraColumns],
  );
}
