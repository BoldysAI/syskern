"use client";

import { use, useMemo, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import {
  ArrowLeft,
  ClockCounterClockwise,
  CurrencyDollar,
  PencilSimple,
  Plus,
  Trash,
  Truck,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { canEdit } from "@/lib/auth";
import { useUiTranslate } from "@/lib/use-ui-translate";
import type { MessageKey } from "@/lib/i18n";
import { useConfirm } from "@/components/ConfirmProvider";
import { useBreadcrumbOverride } from "@/components/layout/BreadcrumbContext";
import { useResizableWidth } from "@/hooks/useResizableWidth";
import { cn } from "@/lib/utils";
import { AppIcon } from "@/components/AppIcon";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { DataTable } from "@/components/data-table";
import type { DataTableColumnDef, DataTableSortState } from "@/components/data-table/types";
import { cycleSortField } from "@/components/data-table/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { CatalogBrowser } from "@/app/catalog/_components/CatalogBrowser";
import {
  getSupplier,
  getSupplierPriceHistory,
  getSupplierSkus,
  removeSupplierSku,
  type Product,
  type Supplier,
  type SupplierPriceHistoryEntry,
  type SupplierProductLink,
} from "@/lib/api";
import { SupplierModal } from "../_components/SupplierModal";
import { BatchPriceWizard } from "../_components/BatchPriceWizard";
import { AddSkusDialog } from "../_components/AddSkusDialog";

const HISTORY_SORT: DataTableSortState = { field: "date", dir: "desc" };

function sourceLabel(
  source: string,
  t: (key: MessageKey, vars?: Record<string, string | number>) => string,
): string {
  if (source === "import") return t("suppliers.source.import");
  if (source === "manual") return t("suppliers.source.manual");
  if (source === "odoo") return t("suppliers.source.odoo");
  return source;
}

export default function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { mutate } = useSWRConfig();
  const confirm = useConfirm();
  const { role } = useAuth();
  const t = useUiTranslate();
  const userCanEdit = canEdit(role);

  const [editOpen, setEditOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [historySort, setHistorySort] = useState<DataTableSortState>(HISTORY_SORT);
  const {
    width: historyPanelWidth,
    startResize: startHistoryResize,
    isResizing: isHistoryResizing,
  } = useResizableWidth(880, {
    min: 560,
    max: 1400,
    storageKey: "syskern:supplier-price-history-width",
    edge: "left",
  });

  const supplierKey = `supplier:${id}`;
  const skusKey = `supplier-skus:${id}`;
  const historyKey = `supplier-history:${id}`;
  const catalogSwrKey = `supplier-catalog:${id}`;

  const { data: supplier, error, isLoading } = useSWR<Supplier>(supplierKey, () => getSupplier(id));
  const { data: skus } = useSWR<SupplierProductLink[]>(skusKey, () => getSupplierSkus(id));
  const { data: history } = useSWR<SupplierPriceHistoryEntry[]>(historyKey, () =>
    getSupplierPriceHistory(id),
  );

  useBreadcrumbOverride(
    useMemo(
      () =>
        supplier
          ? [{ label: t("suppliers.title"), href: "/suppliers" }, { label: supplier.name }]
          : null,
      [supplier, t],
    ),
    Boolean(supplier),
  );

  const linkByProduct = useMemo(() => {
    const m = new Map<string, SupplierProductLink>();
    for (const s of skus ?? []) m.set(s.product, s);
    return m;
  }, [skus]);

  const productNavigationContext = useMemo(
    () =>
      supplier
        ? {
            kind: "supplier" as const,
            supplierId: id,
            supplierName: supplier.name,
          }
        : ({ kind: "catalog" as const }),
    [id, supplier],
  );

  const existingProductIds = useMemo(
    () => new Set((skus ?? []).map((s) => s.product)),
    [skus],
  );

  const refreshLinks = async () => {
    await Promise.all([
      mutate((k) => Array.isArray(k) && k[0] === catalogSwrKey),
      mutate(skusKey),
      mutate(supplierKey),
      mutate(historyKey),
      mutate("suppliers"),
    ]);
  };

  const handleRemoveSku = async (link: SupplierProductLink) => {
    const ok = await confirm({
      title: t("suppliers.detail.removeSkuTitle"),
      description: t("suppliers.detail.removeSkuDescription", { sku: link.product_sku }),
      confirmLabel: t("suppliers.detail.remove"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await removeSupplierSku(id, link.id);
      toast.success(t("suppliers.detail.removed"));
      await refreshLinks();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t("common.error"));
    }
  };

  // Per-supplier PO before PV; unlink action stays at the end.
  const supplierPoColumn = useMemo<DataTableColumnDef<Product>>(
    () => ({
      key: "supplier_po",
      label: t("suppliers.column.poBase"),
      width: 130,
      align: "right",
      render: (p) => {
        const link = linkByProduct.get(p.id);
        if (!link) return <span className="text-muted-foreground">—</span>;
        return (
          <span className="font-data text-foreground">
            {link.po_base_price ?? "—"} {link.po_currency ?? ""}
          </span>
        );
      },
    }),
    [linkByProduct, t],
  );

  const supplierTrailingColumns = useMemo<DataTableColumnDef<Product>[]>(() => {
    if (!userCanEdit) return [];
    return [
      {
        key: "supplier_unlink",
        label: "",
        width: 56,
        render: (p) => {
          const link = linkByProduct.get(p.id);
          if (!link) return null;
          return (
            <Button
              variant="ghost"
              size="icon-sm"
              title={t("suppliers.detail.removeFromSupplier")}
              onClick={(e) => {
                e.stopPropagation();
                void handleRemoveSku(link);
              }}
            >
              <AppIcon icon={Trash} size="sm" className="text-muted-foreground" />
            </Button>
          );
        },
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkByProduct, userCanEdit, t]);

  const historyColumns = useMemo<DataTableColumnDef<SupplierPriceHistoryEntry>[]>(
    () => [
      {
        key: "date",
        label: t("suppliers.column.date"),
        width: 150,
        sortField: "date",
        render: (h) => (
          <span className="text-muted-foreground">
            {new Date(h.created_at).toLocaleDateString("fr-FR", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        ),
      },
      {
        key: "sku",
        label: t("suppliers.column.sku"),
        width: 160,
        sortField: "sku",
        render: (h) => <span className="font-data text-foreground">{h.product_sku}</span>,
      },
      {
        key: "old",
        label: t("suppliers.column.oldPo"),
        width: 110,
        align: "right",
        render: (h) => (
          <span className="font-data text-muted-foreground">{h.old_po_base_price ?? "—"}</span>
        ),
      },
      {
        key: "new",
        label: t("suppliers.column.newPo"),
        width: 110,
        align: "right",
        render: (h) => <span className="font-data text-foreground">{h.new_po_base_price ?? "—"}</span>,
      },
      {
        key: "currency",
        label: t("suppliers.column.currency"),
        width: 90,
        render: (h) => <span className="font-data text-muted-foreground">{h.po_currency}</span>,
      },
      {
        key: "source",
        label: t("suppliers.column.source"),
        width: 110,
        render: (h) => (
          <StatusBadge variant="info">{sourceLabel(h.source, t)}</StatusBadge>
        ),
      },
    ],
    [t],
  );

  const sortedHistory = useMemo(() => {
    const rows = [...(history ?? [])];
    rows.sort((a, b) => {
      let cmp = 0;
      if (historySort.field === "date")
        cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      else if (historySort.field === "sku") cmp = a.product_sku.localeCompare(b.product_sku);
      return historySort.dir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [history, historySort]);

  if (isLoading) {
    return <div className="flex h-full items-center p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  }
  if (error || !supplier) {
    return (
      <div className="flex h-full items-center p-6">
        <EmptyState
          icon={<AppIcon icon={Truck} size="lg" />}
          title={t("suppliers.detail.notFound")}
          action={
            <Button render={<Link href="/suppliers" />} variant="outline">
              <AppIcon icon={ArrowLeft} size="sm" />
              {t("common.back")}
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-4 p-6 pb-4">
        <PageHeader
          title={supplier.name}
          description={t("suppliers.detail.code", { code: supplier.code })}
          meta={
            <StatusBadge variant={supplier.is_active ? "success" : "draft"}>
              {supplier.is_active ? t("suppliers.status.active") : t("suppliers.status.inactive")}
            </StatusBadge>
          }
          actions={
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setHistoryOpen(true)}>
                <AppIcon icon={ClockCounterClockwise} size="sm" />
                {t("suppliers.detail.priceHistory")}
              </Button>
              {userCanEdit && (
                <>
                  <Button variant="outline" onClick={() => setWizardOpen(true)}>
                    <AppIcon icon={CurrencyDollar} size="sm" />
                    {t("suppliers.detail.editPrices")}
                  </Button>
                  <Button variant="outline" onClick={() => setEditOpen(true)}>
                    <AppIcon icon={PencilSimple} size="sm" />
                    {t("common.edit")}
                  </Button>
                </>
              )}
            </div>
          }
        />

        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-foreground">{t("suppliers.detail.defaults")}</h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            <Field label={t("suppliers.column.currency")} value={supplier.currency_default} mono />
            <Field label={t("suppliers.column.incoterm")} value={supplier.incoterm_default || "—"} />
            <Field label={t("suppliers.detail.factoryCode")} value={supplier.factory_code_default || "—"} />
            <Field label={t("suppliers.column.location")} value={supplier.location || "—"} />
          </dl>
          {supplier.notes && (
            <p className="mt-4 whitespace-pre-line text-sm text-muted-foreground">{supplier.notes}</p>
          )}
        </Card>
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-6 pb-6">
        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
          <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
            <h2 className="text-sm font-semibold text-foreground">
              {t("suppliers.column.linkedSkus")}{" "}
              <span className="font-normal text-muted-foreground">({skus?.length ?? 0})</span>
            </h2>
            {userCanEdit && (
              <Button onClick={() => setAddOpen(true)}>
                <AppIcon icon={Plus} size="sm" />
                {t("suppliers.detail.linkSkus")}
              </Button>
            )}
          </div>
          <CatalogBrowser
            className="min-h-0 flex-1 rounded-none border-0 shadow-none"
            variant="embedded"
            swrKey={catalogSwrKey}
            pageSize={50}
            density="compact"
            enableSavedFilters={false}
            title={t("suppliers.detail.skuTitle")}
            initialFilters={{ supplier: [supplier.name] }}
            productNavigationContext={productNavigationContext}
            filtersCollapsedStorageKey="syskern:supplier-skus-filters-collapsed"
            filtersWidthStorageKey="syskern:supplier-skus-filters-width"
            paginationJumpInputId="supplier-skus-page"
            extraColumns={[supplierPoColumn]}
            insertExtraColumnsBefore="catalog_pv"
            trailingExtraColumns={supplierTrailingColumns}
          />
        </Card>
      </div>

      {/* Price history — resizable side panel */}
      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent
          side="right"
          className="flex h-full max-w-none flex-col gap-0 p-0 sm:max-w-none"
          style={{ width: historyPanelWidth, maxWidth: "96vw" }}
        >
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t("suppliers.detail.resizeHistory")}
            onMouseDown={startHistoryResize}
            className={cn(
              "absolute left-0 top-0 z-20 flex h-full w-1.5 cursor-col-resize touch-none items-center justify-center transition-colors",
              "hover:bg-primary/20",
              isHistoryResizing && "bg-primary/30",
            )}
          >
            <span className="h-10 w-0.5 rounded-full bg-border" />
          </div>

          <SheetHeader className="shrink-0 border-b border-border px-5 py-4 pr-12">
            <SheetTitle>{t("suppliers.detail.priceHistory")}</SheetTitle>
            <SheetDescription>
              {t("suppliers.detail.historyDescription", { name: supplier.name })}
            </SheetDescription>
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-2">
            <DataTable
              className="min-h-0 flex-1"
              columns={historyColumns}
              rows={sortedHistory}
              rowKey={(h) => h.id}
              storageKey="supplier-price-history"
              sort={historySort}
              defaultSort={HISTORY_SORT}
              onSort={(field) => setHistorySort((s) => cycleSortField(field, s, HISTORY_SORT))}
              density="compact"
              emptyState={
                <EmptyState
                  className="border-none bg-transparent shadow-none"
                  icon={<AppIcon icon={ClockCounterClockwise} size="lg" />}
                  title={t("suppliers.detail.historyEmpty")}
                />
              }
            />
          </div>
        </SheetContent>
      </Sheet>

      {editOpen && (
        <SupplierModal
          supplier={supplier}
          open
          onClose={() => {
            setEditOpen(false);
            void mutate(supplierKey);
          }}
        />
      )}

      {wizardOpen && (
        <BatchPriceWizard
          open
          initialSupplier={supplier}
          onClose={() => setWizardOpen(false)}
          onApplied={refreshLinks}
        />
      )}

      {addOpen && (
        <AddSkusDialog
          supplierId={id}
          supplierName={supplier.name}
          existingProductIds={existingProductIds}
          open
          onClose={() => setAddOpen(false)}
          onLinked={refreshLinks}
        />
      )}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={mono ? "font-data text-sm text-foreground" : "text-sm text-foreground"}>
        {value}
      </dd>
    </div>
  );
}
