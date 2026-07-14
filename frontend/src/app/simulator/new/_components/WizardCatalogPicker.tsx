"use client";

import { useCallback } from "react";
import type { Product } from "@/lib/api";
import { CatalogBrowser } from "@/app/catalog/_components/CatalogBrowser";
import { CATALOG_COLUMN_WIDTHS_KEY } from "@/app/catalog/_components/useColumnWidths";
import type { SelectedSku } from "./wizard-draft";

interface Props {
  selectedIds: Set<string>;
  onAdd: (skus: SelectedSku[]) => void;
  onRemove: (id: string) => void;
  onRemoveMany: (ids: string[]) => void;
  className?: string;
}

/** Sélection catalogue wizard — délègue à `CatalogBrowser` (même tableau que `/catalog`). */
export function WizardCatalogPicker({
  selectedIds,
  onAdd,
  onRemove,
  onRemoveMany,
  className,
}: Props) {
  const onToggleProduct = useCallback(
    (product: Product) => {
      if (selectedIds.has(product.id)) {
        onRemove(product.id);
      } else {
        onAdd([{ id: product.id, sku_code: product.sku_code, name: product.name }]);
      }
    },
    [onAdd, onRemove, selectedIds],
  );

  const onTogglePageProducts = useCallback(
    (products: Product[], select: boolean) => {
      if (select) {
        onAdd(
          products
            .filter((p) => !selectedIds.has(p.id))
            .map((p) => ({ id: p.id, sku_code: p.sku_code, name: p.name })),
        );
      } else {
        onRemoveMany(products.map((p) => p.id));
      }
    },
    [onAdd, onRemoveMany, selectedIds],
  );

  const onToggleFilteredProducts = useCallback(
    (products: Product[], select: boolean) => {
      if (select) {
        onAdd(
          products
            .filter((p) => !selectedIds.has(p.id))
            .map((p) => ({ id: p.id, sku_code: p.sku_code, name: p.name })),
        );
      } else {
        onRemoveMany(products.map((p) => p.id));
      }
    },
    [onAdd, onRemoveMany, selectedIds],
  );

  return (
    <CatalogBrowser
      className={className}
      variant="embedded"
      skuAsLink={false}
      pageSize={50}
      columnWidthsKey={CATALOG_COLUMN_WIDTHS_KEY}
      swrKey="wizard-catalog"
      density="compact"
      filtersCollapsedStorageKey="syskern:wizard-catalog-filters-collapsed"
      filtersWidthStorageKey="syskern:wizard-catalog-filters-width"
      paginationJumpInputId="wizard-catalog-page-jump"
      title="Catalogue"
      selectedIds={selectedIds}
      onToggleProduct={onToggleProduct}
      onTogglePageProducts={onTogglePageProducts}
      onToggleFilteredProducts={onToggleFilteredProducts}
    />
  );
}
