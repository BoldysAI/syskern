"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, X } from "@phosphor-icons/react";
import type { CatalogFilters, Product } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { canEdit } from "@/lib/auth";
import { AddToSimulationDialog } from "@/components/AddToSimulationDialog";
import { Button } from "@/components/ui/button";
import { CatalogBrowser } from "./_components/CatalogBrowser";
import { ProductDrawer } from "./_components/ProductDrawer";
import { ExportButton } from "./_components/ExportButton";

export default function CatalogPage() {
  const { role } = useAuth();
  const userCanEdit = canEdit(role);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawerSku, setDrawerSku] = useState<string | null>(null);

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

  const selectionBar = useCallback(
    ({ selectedIds: ids, filters }: { selectedIds: string[]; filters: CatalogFilters }) => (
      <div className="flex shrink-0 items-center justify-between border-b border-primary/20 bg-primary/5 px-4 py-2.5 sm:px-6">
        <span className="text-sm font-semibold text-foreground">
          {ids.length} sélectionné{ids.length > 1 ? "s" : ""}
        </span>
        <div className="flex items-center gap-2">
          <ExportButton filters={filters} selectedIds={ids} />
          <AddToSimulationDialog
            productIds={ids}
            productLabel={`${ids.length} produit${ids.length > 1 ? "s" : ""}`}
            onAdded={() => setSelected(new Set())}
          >
            <Button size="sm">
              <Plus size={15} weight="bold" />
              Ajouter à simulation
            </Button>
          </AddToSimulationDialog>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setSelected(new Set())}
            title="Vider la sélection"
            aria-label="Vider la sélection"
          >
            <X size={16} weight="bold" />
          </Button>
        </div>
      </div>
    ),
    [],
  );

  return (
    <>
      <CatalogBrowser
        variant="page"
        selectedIds={selected}
        onToggleProduct={onToggleProduct}
        onTogglePageProducts={onTogglePageProducts}
        onRowClick={(product) => setDrawerSku(product.sku_code)}
        toolbarActions={({ filters, total }) => (
          <>
            <ExportButton filters={filters} disabled={total === 0} />
            {userCanEdit && (
              <Button nativeButton={false} render={<Link href="/catalog/new" />} title="Créer un produit">
                <Plus size={16} weight="bold" />
                <span className="hidden sm:inline">Nouveau produit</span>
              </Button>
            )}
          </>
        )}
        selectionBar={selectionBar}
        paginationJumpInputId="catalog-page-jump"
      />
      <ProductDrawer sku={drawerSku} onClose={() => setDrawerSku(null)} />
    </>
  );
}
