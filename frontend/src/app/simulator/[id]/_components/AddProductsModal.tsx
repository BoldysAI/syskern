"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { CircleNotch, Package } from "@phosphor-icons/react";
import {
  addSimulationLines,
  getSimulationLines,
  type Product,
} from "@/lib/api";
import { humanizeApiError } from "@/lib/humanize-errors";
import { CatalogBrowser } from "@/app/catalog/_components/CatalogBrowser";
import { CATALOG_COLUMN_WIDTHS_KEY } from "@/app/catalog/_components/useColumnWidths";
import type { DataTableColumnDef } from "@/components/data-table";
import type { SelectedSku } from "@/app/simulator/new/_components/wizard-draft";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

interface Props {
  simId: string;
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
}

export function AddProductsModal({ simId, open, onClose, onAdded }: Props) {
  const [selected, setSelected] = useState<Map<string, SelectedSku>>(new Map());
  const [submitting, setSubmitting] = useState(false);

  const { data: existingIds } = useSWR<Set<string>>(
    open ? ["sim-product-ids", simId] : null,
    async () => {
      const r = await getSimulationLines({ simulation: simId, page: 1, limit: 5000 });
      return new Set(r.results.map((line) => line.product));
    },
    { revalidateOnFocus: false },
  );
  const existing = existingIds ?? new Set<string>();

  const selectedList = useMemo(() => [...selected.values()], [selected]);
  const selectedIds = useMemo(() => new Set(selected.keys()), [selected]);

  const extraColumns = useMemo<DataTableColumnDef<Product>[]>(
    () => [
      {
        key: "in_sim",
        label: "",
        width: 120,
        render: (product) =>
          existing.has(product.id) ? (
            <span className="text-xs font-medium text-muted-foreground">Déjà ajouté</span>
          ) : null,
      },
    ],
    [existing],
  );

  const toggleRow = (product: Product) => {
    if (existing.has(product.id)) return;
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(product.id)) next.delete(product.id);
      else next.set(product.id, { id: product.id, sku_code: product.sku_code, name: product.name });
      return next;
    });
  };

  const togglePageProducts = (products: Product[], select: boolean) => {
    setSelected((prev) => {
      const next = new Map(prev);
      for (const product of products) {
        if (existing.has(product.id)) continue;
        if (select) {
          next.set(product.id, { id: product.id, sku_code: product.sku_code, name: product.name });
        } else {
          next.delete(product.id);
        }
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

  const handleAdd = async () => {
    const toAdd = selectedList.filter((s) => !existing.has(s.id));
    if (toAdd.length === 0) {
      toast.error("Sélectionnez au moins un produit qui n'est pas déjà dans la simulation.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await addSimulationLines(
        simId,
        toAdd.map((s) => s.id),
      );
      const added = res.added ?? toAdd.length;
      const skipped = selectedList.length - toAdd.length;
      onAdded();
      handleOpenChange(false);
      toast.success(
        added === 1 ? "1 produit ajouté à la simulation." : `${added} produits ajoutés à la simulation.`,
      );
      if (skipped > 0) {
        toast.info(
          skipped === 1
            ? "1 produit déjà présent ignoré."
            : `${skipped} produits déjà présents ignorés.`,
        );
      }
    } catch (e) {
      toast.error(humanizeApiError(e, "Ajout des produits échoué."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="flex max-h-[92vh] max-w-6xl flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl"
        showCloseButton={!submitting}
      >
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>Ajouter des produits</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Recherchez et filtrez comme dans le catalogue, puis sélectionnez les produits à ajouter.
          </p>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <CatalogBrowser
            key={open ? simId : "closed"}
            className="min-h-[280px] flex-1 rounded-none border-0 shadow-none"
            variant="embedded"
            enabled={open}
            skuAsLink={false}
            pageSize={50}
            columnWidthsKey={CATALOG_COLUMN_WIDTHS_KEY}
            swrKey="add-products-catalog"
            density="compact"
            enableSavedFilters={false}
            filtersCollapsedStorageKey="syskern:sim-add-products-filters-collapsed"
            filtersWidthStorageKey="syskern:sim-add-products-filters-width"
            paginationJumpInputId="sim-add-products-page"
            title="Catalogue"
            selectedIds={selectedIds}
            onToggleProduct={toggleRow}
            onTogglePageProducts={togglePageProducts}
            disabledRowIds={existing}
            extraColumns={extraColumns}
          />

          <aside className="flex w-full shrink-0 flex-col border-t border-border md:w-56 md:border-l md:border-t-0 lg:w-64">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
              <Package size={16} className="text-warm" />
              <span className="text-sm font-semibold">Sélection</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {selectedList.length} sélectionné{selectedList.length !== 1 ? "s" : ""}
              </span>
            </div>
            <ul className="max-h-48 flex-1 divide-y divide-border overflow-y-auto md:max-h-none">
              {selectedList.length === 0 ? (
                <li className="px-3 py-6 text-center text-xs text-muted-foreground">
                  Aucun produit sélectionné.
                </li>
              ) : (
                selectedList.map((s) => (
                  <li key={s.id} className="flex items-start gap-2 px-3 py-2 text-sm">
                    <span className="font-mono text-xs font-semibold text-foreground">{s.sku_code}</span>
                    <button
                      type="button"
                      className="ml-auto shrink-0 text-xs text-muted-foreground hover:text-destructive"
                      onClick={() =>
                        setSelected((prev) => {
                          const next = new Map(prev);
                          next.delete(s.id);
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
            {selectedList.length > 0 && (
              <div className="border-t border-border p-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs"
                  onClick={() => setSelected(new Map())}
                >
                  Vider la sélection
                </Button>
              </div>
            )}
          </aside>
        </div>

        <DialogFooter className="border-t border-border px-5 py-4">
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={submitting}>
            Annuler
          </Button>
          <Button
            type="button"
            onClick={handleAdd}
            disabled={submitting || selectedList.filter((s) => !existing.has(s.id)).length === 0}
            className="gap-2"
          >
            {submitting && <CircleNotch size={15} className="animate-spin" />}
            Ajouter{" "}
            {selectedList.filter((s) => !existing.has(s.id)).length > 0
              ? `(${selectedList.filter((s) => !existing.has(s.id)).length})`
              : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
