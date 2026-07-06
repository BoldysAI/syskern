"use client";

import Link from "next/link";
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { StatusBadge, universeBadgeVariant } from "@/components/StatusBadge";
import { formatAttributeDisplayValue } from "@/components/AttributeRenderer";
import type { AttributeRegistry, Product } from "@/lib/api";
import type { DataTableColumnDef } from "@/components/data-table";
import {
  attrColumnKey,
  attrSortField,
  CATALOG_COLUMN_ORDER,
} from "./catalog-column-registry";
import { CatalogPvDisplay } from "./catalog-pv-display";
import { visibleAttrCodes } from "./catalog-column-storage";

export function parseDec(v?: string | null): number {
  return v != null ? parseFloat(v) : 0;
}

function UniverseBadge({ universe }: { universe: string }) {
  if (!universe) return <span className="text-muted-foreground/50">—</span>;
  return <StatusBadge variant={universeBadgeVariant(universe)}>{universe}</StatusBadge>;
}

function CoverageBadge({ product }: { product: Product }) {
  const coverage = product.i18n_coverage;
  if (!coverage || coverage.languages.length === 0) {
    return <span className="text-muted-foreground/50">—</span>;
  }
  const label = coverage.languages.map((l) => l.toUpperCase()).join("·");
  return (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium tabular-nums"
      title={`${coverage.percent}% des langues renseignées`}
    >
      <span
        aria-hidden
        className={cn(
          "size-1 shrink-0 rounded-full",
          coverage.complete ? "bg-emerald-500" : "bg-amber-500",
        )}
      />
      <span className={cn(coverage.complete ? "text-foreground" : "text-muted-foreground")}>
        {label}
      </span>
    </span>
  );
}

export interface UseCatalogColumnsOptions {
  skuAsLink?: boolean;
  extraColumns?: DataTableColumnDef<Product>[];
  /** Keys from catalog-column-registry (+ attr:code). Empty = defaults. */
  visibleColumnKeys?: string[];
  attributeColumns?: AttributeRegistry[];
}

function buildCoreColumnDef(
  key: string,
  skuAsLink: boolean,
): DataTableColumnDef<Product> | null {
  switch (key) {
    case "sku_code":
      return {
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
      };
    case "name":
      return {
        key: "name",
        label: "Désignation",
        sortField: "name",
        width: 280,
        cellClassName: "text-sm text-muted-foreground truncate",
        render: (product) => product.name,
      };
    case "universe":
      return {
        key: "universe",
        label: "Univers",
        sortField: "universe",
        width: 160,
        render: (product) => <UniverseBadge universe={product.universe} />,
      };
    case "family":
      return {
        key: "family",
        label: "Famille",
        sortField: "family",
        width: 150,
        cellClassName: "text-sm text-muted-foreground truncate",
        render: (product) => product.family || "—",
      };
    case "range":
      return {
        key: "range",
        label: "Gamme",
        sortField: "range",
        width: 140,
        cellClassName: "text-sm text-muted-foreground truncate",
        render: (product) => product.range || "—",
      };
    case "sub_range":
      return {
        key: "sub_range",
        label: "Sous-gamme",
        sortField: "sub_range",
        width: 140,
        cellClassName: "text-sm text-muted-foreground truncate",
        render: (product) => product.sub_range || "—",
      };
    case "brand":
      return {
        key: "brand",
        label: "Marque",
        sortField: "brand",
        width: 130,
        cellClassName: "text-sm text-muted-foreground truncate",
        render: (product) => product.brand || "—",
      };
    case "active_supplier":
      return {
        key: "active_supplier",
        label: "Fournisseur actif",
        sortField: "active_supplier",
        width: 170,
        cellClassName: "text-sm text-muted-foreground truncate",
        render: (product) => product.active_supplier || "—",
      };
    case "pamp_eur":
      return {
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
      };
    case "catalog_pv":
      return {
        key: "catalog_pv",
        label: "PV",
        width: 148,
        align: "right",
        cellClassName: "align-top py-2.5",
        render: (product) => <CatalogPvDisplay pv={product.catalog_pv} size="sm" />,
      };
    case "stock_quantity":
      return {
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
      };
    case "is_copper_indexed":
      return {
        key: "is_copper_indexed",
        label: "Indexé cuivre",
        sortField: "is_copper_indexed",
        width: 110,
        render: (product) => (
          <StatusBadge variant={product.is_copper_indexed ? "success" : "draft"}>
            {product.is_copper_indexed ? "Oui" : "Non"}
          </StatusBadge>
        ),
      };
    case "is_active":
      return {
        key: "is_active",
        label: "Actif",
        sortField: "is_active",
        width: 80,
        render: (product) => (
          <StatusBadge variant={product.is_active ? "success" : "draft"}>
            {product.is_active ? "Oui" : "Non"}
          </StatusBadge>
        ),
      };
    case "lang_coverage":
      return {
        key: "lang_coverage",
        label: "Langues",
        width: 80,
        cellClassName: "!px-2",
        render: (product) => <CoverageBadge product={product} />,
      };
    default:
      return null;
  }
}

/** Colonnes du tableau catalogue — source unique pour toutes les vues catalogue. */
export function useCatalogColumns({
  skuAsLink = true,
  extraColumns = [],
  visibleColumnKeys,
  attributeColumns = [],
}: UseCatalogColumnsOptions = {}) {
  return useMemo<DataTableColumnDef<Product>[]>(() => {
    const attrByCode = new Map(attributeColumns.map((a) => [a.code, a]));
    const attrKeys = attributeColumns
      .slice()
      .sort((a, b) => a.display_order - b.display_order || a.code.localeCompare(b.code))
      .map((a) => attrColumnKey(a.code));

    const orderedKeys =
      visibleColumnKeys && visibleColumnKeys.length > 0
        ? visibleColumnKeys.filter((k) => {
            if (k.startsWith("attr:")) return attrByCode.has(k.slice(5));
            return buildCoreColumnDef(k, skuAsLink) != null;
          })
        : [...CATALOG_COLUMN_ORDER.filter((k) => k !== "lang_coverage"), ...attrKeys];

    const cols: DataTableColumnDef<Product>[] = [];

    for (const key of orderedKeys) {
      if (key.startsWith("attr:")) {
        const code = key.slice(5);
        const attr = attrByCode.get(code);
        if (!attr) continue;
        cols.push({
          key,
          label: attr.label.fr || attr.label.en || attr.code,
          sortField: attrSortField(code),
          width: 140,
          cellClassName: "text-sm text-muted-foreground truncate",
          render: (product) =>
            formatAttributeDisplayValue(attr, product.attribute_values?.[code]),
        });
        continue;
      }
      const core = buildCoreColumnDef(key, skuAsLink);
      if (core) cols.push(core);
    }

    return [...cols, ...extraColumns];
  }, [skuAsLink, extraColumns, visibleColumnKeys, attributeColumns]);
}

export { visibleAttrCodes };
