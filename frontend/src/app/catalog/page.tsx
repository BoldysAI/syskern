"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { Plus, Translate, X } from "@phosphor-icons/react";
import type { CatalogFilters, Product } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { canEdit } from "@/lib/auth";
import { useUiTranslate } from "@/lib/use-ui-translate";
import { AddToSimulationDialog } from "@/components/AddToSimulationDialog";
import { Button } from "@/components/ui/button";
import { CatalogBrowser } from "./_components/CatalogBrowser";
import { ProductDrawer } from "./_components/ProductDrawer";
import { ExportButton } from "./_components/ExportButton";
import { BulkTranslateDialog } from "./_components/BulkTranslateDialog";

export default function CatalogPage() {
  const { role } = useAuth();
  const t = useUiTranslate();
  const userCanEdit = canEdit(role);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawerSku, setDrawerSku] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkIds, setBulkIds] = useState<string[]>([]);

  const onToggleProduct = useCallback((product: Product) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(product.id)) next.delete(product.id);
      else next.add(product.id);
      return next;
    });
  }, []);

  const onTogglePageProducts = useCallback((products: Product[], select: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const product of products) {
        if (select) next.add(product.id);
        else next.delete(product.id);
      }
      return next;
    });
  }, []);

  const onToggleFilteredProducts = useCallback((products: Product[], select: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const product of products) {
        if (select) next.add(product.id);
        else next.delete(product.id);
      }
      return next;
    });
  }, []);

  const selectionBar = useCallback(
    ({ selectedIds: ids, filters }: { selectedIds: string[]; filters: CatalogFilters }) => (
      <div className="flex shrink-0 items-center justify-between border-b border-primary/20 bg-primary/5 px-4 py-2.5 sm:px-6">
        <span className="text-sm font-semibold text-foreground">
          {t(ids.length > 1 ? "catalog.selection.other" : "catalog.selection.one", {
            count: ids.length,
          })}
        </span>
        <div className="flex items-center gap-2">
          <ExportButton filters={filters} selectedIds={ids} />
          {userCanEdit && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setBulkIds(ids);
                setBulkOpen(true);
              }}
            >
              <Translate size={15} weight="duotone" />
              {t("catalog.action.translate")}
            </Button>
          )}
          <AddToSimulationDialog
            productIds={ids}
            productLabel={t(
              ids.length > 1 ? "catalog.productCount.other" : "catalog.productCount.one",
              { count: ids.length },
            )}
            onAdded={() => setSelected(new Set())}
          >
            <Button size="sm">
              <Plus size={15} weight="bold" />
              {t("catalog.action.addToSimulation")}
            </Button>
          </AddToSimulationDialog>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setSelected(new Set())}
            title={t("catalog.action.clearSelection")}
            aria-label={t("catalog.action.clearSelection")}
          >
            <X size={16} weight="bold" />
          </Button>
        </div>
      </div>
    ),
    [t, userCanEdit],
  );

  return (
    <>
      <CatalogBrowser
        variant="page"
        selectedIds={selected}
        onToggleProduct={onToggleProduct}
        onTogglePageProducts={onTogglePageProducts}
        onToggleFilteredProducts={onToggleFilteredProducts}
        onRowClick={(product) => setDrawerSku(product.sku_code)}
        toolbarActions={({ filters, total }) => (
          <>
            <ExportButton filters={filters} disabled={total === 0} />
            {userCanEdit && (
              <Button nativeButton={false} render={<Link href="/catalog/new" />} title={t("catalog.action.createProduct")}>
                <Plus size={16} weight="bold" />
                <span className="hidden sm:inline">{t("catalog.action.newProduct")}</span>
              </Button>
            )}
          </>
        )}
        selectionBar={selectionBar}
        paginationJumpInputId="catalog-page-jump"
      />
      <ProductDrawer sku={drawerSku} onClose={() => setDrawerSku(null)} />
      <BulkTranslateDialog
        productIds={bulkIds}
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        onDone={() => setSelected(new Set())}
      />
    </>
  );
}
