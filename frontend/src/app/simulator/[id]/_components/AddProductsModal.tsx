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
import { useUiTranslate } from "@/lib/use-ui-translate";

interface Props {
  simId: string;
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
}

export function AddProductsModal({ simId, open, onClose, onAdded }: Props) {
  const t = useUiTranslate();
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
            <span className="text-xs font-medium text-muted-foreground">{t("simulator.add.already")}</span>
          ) : null,
      },
    ],
    [existing, t],
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

  const toggleFilteredProducts = (products: Product[], select: boolean) => {
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
      toast.error(t("simulator.add.needOne"));
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
        added === 1
          ? t("simulator.add.addedOne")
          : t("simulator.add.addedOther", { count: added }),
      );
      if (skipped > 0) {
        toast.info(
          skipped === 1
            ? t("simulator.add.skippedOne")
            : t("simulator.add.skippedOther", { count: skipped }),
        );
      }
    } catch (e) {
      toast.error(humanizeApiError(e, t("simulator.add.failed")));
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
          <DialogTitle>{t("simulator.add.title")}</DialogTitle>
          <p className="text-sm text-muted-foreground">{t("simulator.add.help")}</p>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <CatalogBrowser
            key={open ? simId : "closed"}
            className="min-h-[280px] flex-1 rounded-none border-0 shadow-none"
            variant="embedded"
            simulationId={simId}
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
            title={t("simulator.catalog.title")}
            selectedIds={selectedIds}
            onToggleProduct={toggleRow}
            onTogglePageProducts={togglePageProducts}
            onToggleFilteredProducts={toggleFilteredProducts}
            disabledRowIds={existing}
            extraColumns={extraColumns}
          />

          <aside className="flex w-full shrink-0 flex-col border-t border-border md:w-56 md:border-l md:border-t-0 lg:w-64">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
              <Package size={16} className="text-warm" />
              <span className="text-sm font-semibold">{t("simulator.add.selection")}</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {selectedList.length !== 1
                  ? t("simulator.list.selectedOther", { count: selectedList.length })
                  : t("simulator.list.selectedOne", { count: selectedList.length })}
              </span>
            </div>
            <ul className="max-h-48 flex-1 divide-y divide-border overflow-y-auto md:max-h-none">
              {selectedList.length === 0 ? (
                <li className="px-3 py-6 text-center text-xs text-muted-foreground">
                  {t("simulator.add.none")}
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
                      {t("simulator.lines.removeAction")}
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
                  {t("simulator.list.clearSelection")}
                </Button>
              </div>
            )}
          </aside>
        </div>

        <DialogFooter className="border-t border-border px-5 py-4">
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            onClick={handleAdd}
            disabled={submitting || selectedList.filter((s) => !existing.has(s.id)).length === 0}
            className="gap-2"
          >
            {submitting && <CircleNotch size={15} className="animate-spin" />}
            {t("simulator.add.action")}{" "}
            {selectedList.filter((s) => !existing.has(s.id)).length > 0
              ? `(${selectedList.filter((s) => !existing.has(s.id)).length})`
              : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
