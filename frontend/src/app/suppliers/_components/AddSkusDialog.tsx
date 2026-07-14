"use client";

import { useMemo, useState } from "react";
import { CircleNotch, Package } from "@phosphor-icons/react";
import { toast } from "sonner";
import { bulkLinkSkus, type Product } from "@/lib/api";
import { CatalogBrowser } from "@/app/catalog/_components/CatalogBrowser";
import type { DataTableColumnDef } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  supplierId: string;
  supplierName: string;
  existingProductIds: Set<string>;
  open: boolean;
  onClose: () => void;
  onLinked: () => void | Promise<void>;
}

export function AddSkusDialog({
  supplierId,
  supplierName,
  existingProductIds,
  open,
  onClose,
  onLinked,
}: Props) {
  const [selected, setSelected] = useState<Map<string, string>>(new Map());
  const [submitting, setSubmitting] = useState(false);

  const selectedIds = useMemo(() => new Set(selected.keys()), [selected]);
  const selectedCount = selected.size;

  const extraColumns = useMemo<DataTableColumnDef<Product>[]>(
    () => [
      {
        key: "linked",
        label: "",
        width: 110,
        render: (p) =>
          existingProductIds.has(p.id) ? (
            <span className="text-xs font-medium text-muted-foreground">Déjà lié</span>
          ) : null,
      },
    ],
    [existingProductIds],
  );

  const toggleRow = (p: Product) => {
    if (existingProductIds.has(p.id)) return;
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(p.id)) next.delete(p.id);
      else next.set(p.id, p.sku_code);
      return next;
    });
  };

  const togglePage = (products: Product[], select: boolean) => {
    setSelected((prev) => {
      const next = new Map(prev);
      for (const p of products) {
        if (existingProductIds.has(p.id)) continue;
        if (select) next.set(p.id, p.sku_code);
        else next.delete(p.id);
      }
      return next;
    });
  };

  const toggleFiltered = (products: Product[], select: boolean) => {
    setSelected((prev) => {
      const next = new Map(prev);
      for (const p of products) {
        if (existingProductIds.has(p.id)) continue;
        if (select) next.set(p.id, p.sku_code);
        else next.delete(p.id);
      }
      return next;
    });
  };

  const handleOpenChange = (next: boolean) => {
    if (!next && !submitting) {
      setSelected(new Map());
      onClose();
    }
  };

  const handleLink = async () => {
    if (selectedCount === 0) return;
    setSubmitting(true);
    try {
      const res = await bulkLinkSkus(supplierId, [...selected.keys()]);
      await onLinked();
      toast.success(
        res.created === 1 ? "1 SKU lié au fournisseur." : `${res.created} SKU liés au fournisseur.`,
      );
      handleOpenChange(false);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="flex h-[92vh] w-[95vw] max-w-[95vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-[95vw]"
        showCloseButton={!submitting}
      >
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>Lier des SKU à {supplierName}</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Recherchez et filtrez comme dans le catalogue, puis sélectionnez les SKU à lier.
          </p>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <CatalogBrowser
            key={open ? supplierId : "closed"}
            className="min-h-0 flex-1 rounded-none border-0 shadow-none"
            variant="embedded"
            enabled={open}
            skuAsLink={false}
            pageSize={50}
            swrKey="supplier-add-skus-catalog"
            density="compact"
            enableSavedFilters={false}
            filtersCollapsedStorageKey="syskern:supplier-add-skus-filters-collapsed"
            filtersWidthStorageKey="syskern:supplier-add-skus-filters-width"
            paginationJumpInputId="supplier-add-skus-page"
            title="Catalogue"
            selectedIds={selectedIds}
            onToggleProduct={toggleRow}
            onTogglePageProducts={togglePage}
            onToggleFilteredProducts={toggleFiltered}
            disabledRowIds={existingProductIds}
            extraColumns={extraColumns}
          />

          <aside className="flex w-full shrink-0 flex-col border-t border-border md:w-56 md:border-l md:border-t-0 lg:w-64">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
              <Package size={16} className="text-primary" />
              <span className="text-sm font-semibold">Sélection</span>
              <span className="ml-auto text-xs text-muted-foreground">{selectedCount}</span>
            </div>
            <ul className="max-h-48 flex-1 divide-y divide-border overflow-y-auto md:max-h-none">
              {selectedCount === 0 ? (
                <li className="px-3 py-6 text-center text-xs text-muted-foreground">
                  Aucun SKU sélectionné.
                </li>
              ) : (
                [...selected.entries()].map(([id, sku]) => (
                  <li key={id} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <span className="font-data text-xs font-semibold text-foreground">{sku}</span>
                    <button
                      type="button"
                      className="ml-auto shrink-0 text-xs text-muted-foreground hover:text-destructive"
                      onClick={() =>
                        setSelected((prev) => {
                          const next = new Map(prev);
                          next.delete(id);
                          return next;
                        })
                      }
                    >
                      Retirer
                    </button>
                  </li>
                ))
              )}
            </ul>
          </aside>
        </div>

        <DialogFooter className="border-t border-border px-5 py-4">
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={submitting}>
            Annuler
          </Button>
          <Button type="button" onClick={handleLink} disabled={submitting || selectedCount === 0} className="gap-2">
            {submitting && <CircleNotch size={15} className="animate-spin" />}
            Lier {selectedCount > 0 ? `(${selectedCount})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
