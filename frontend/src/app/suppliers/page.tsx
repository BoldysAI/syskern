"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR, { mutate } from "swr";
import { toast } from "sonner";
import {
  CurrencyDollar,
  Faders,
  PencilSimple,
  Plus,
  SidebarSimple,
  Trash,
  Truck,
  UploadSimple,
} from "@phosphor-icons/react";
import { useAuth } from "@/contexts/AuthContext";
import { canEdit } from "@/lib/auth";
import { useUiTranslate } from "@/lib/use-ui-translate";
import { useConfirm } from "@/components/ConfirmProvider";
import { usePersistedBoolean } from "@/hooks/usePersistedBoolean";
import { DataTable } from "@/components/data-table";
import type { DataTableColumnDef, DataTableSortState } from "@/components/data-table/types";
import { cycleSortField } from "@/components/data-table/types";
import { AppIcon } from "@/components/AppIcon";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { SearchInput } from "@/components/SearchInput";
import { Button } from "@/components/ui/button";
import { deleteSupplier, listSuppliers, type Supplier } from "@/lib/api";
import { SupplierModal } from "./_components/SupplierModal";
import { PoImportWizard } from "./_components/PoImportWizard";
import { BatchPriceWizard } from "./_components/BatchPriceWizard";
import { SuppliersFiltersSidebar } from "./_components/SuppliersFiltersSidebar";
import { SuppliersActiveFilterBar } from "./_components/SuppliersActiveFilterBar";
import {
  applySupplierFilters,
  countActiveSupplierFilters,
  type SupplierFilters,
} from "./_components/supplier-filters";

const DEFAULT_SORT: DataTableSortState = { field: "name", dir: "asc" };
const SIDEBAR_COLLAPSED_KEY = "syskern:suppliers-filters-collapsed";

export default function SuppliersPage() {
  const router = useRouter();
  const confirm = useConfirm();
  const { role } = useAuth();
  const t = useUiTranslate();
  const userCanEdit = canEdit(role);

  const [modal, setModal] = useState<Supplier | "new" | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [sort, setSort] = useState<DataTableSortState>(DEFAULT_SORT);

  const [filters, setFilters] = useState<SupplierFilters>({});
  const [searchInput, setSearchInput] = useState("");
  const [collapsed, , toggleCollapsed] = usePersistedBoolean(SIDEBAR_COLLAPSED_KEY, false);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSearchChange = (v: string) => {
    setSearchInput(v);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setFilters((f) => ({ ...f, q: v || undefined }));
    }, 250);
  };

  const resetFilters = () => {
    setFilters({});
    setSearchInput("");
  };

  const { data: suppliers, isLoading, error } = useSWR<Supplier[]>("suppliers", () =>
    listSuppliers(),
  );

  const rows = useMemo(() => {
    const filtered = applySupplierFilters(suppliers ?? [], filters);
    const copy = [...filtered];
    copy.sort((a, b) => {
      let cmp = 0;
      if (sort.field === "name") cmp = a.name.localeCompare(b.name);
      else if (sort.field === "code") cmp = a.code.localeCompare(b.code);
      else if (sort.field === "linked_skus_count")
        cmp = (a.linked_skus_count ?? 0) - (b.linked_skus_count ?? 0);
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [suppliers, filters, sort]);

  const activeCount = countActiveSupplierFilters(filters);

  const columns = useMemo<DataTableColumnDef<Supplier>[]>(
    () => [
      {
        key: "name",
        label: t("suppliers.column.supplier"),
        width: 260,
        sortField: "name",
        render: (s) => (
          <div>
            <div className="text-sm font-medium text-foreground">{s.name}</div>
            <div className="text-xs text-muted-foreground">{s.code}</div>
          </div>
        ),
      },
      {
        key: "currency_default",
        label: t("suppliers.column.currency"),
        width: 100,
        render: (s) => <span className="font-data text-sm text-foreground">{s.currency_default}</span>,
      },
      {
        key: "incoterm_default",
        label: t("suppliers.column.incoterm"),
        width: 120,
        render: (s) => (
          <span className="text-sm text-muted-foreground">{s.incoterm_default || "—"}</span>
        ),
      },
      {
        key: "location",
        label: t("suppliers.column.location"),
        width: 200,
        render: (s) => <span className="text-sm text-muted-foreground">{s.location || "—"}</span>,
      },
      {
        key: "linked_skus_count",
        label: t("suppliers.column.linkedSkus"),
        width: 110,
        align: "right",
        sortField: "linked_skus_count",
        render: (s) => (
          <span className="font-data text-sm text-foreground">{s.linked_skus_count ?? 0}</span>
        ),
      },
      {
        key: "is_active",
        label: t("suppliers.column.status"),
        width: 110,
        render: (s) => (
          <StatusBadge variant={s.is_active ? "success" : "draft"}>
            {s.is_active ? t("suppliers.status.active") : t("suppliers.status.inactive")}
          </StatusBadge>
        ),
      },
    ],
    [t],
  );

  const handleDelete = async (s: Supplier) => {
    const ok = await confirm({
      title: t("suppliers.list.deleteTitle"),
      description: t("suppliers.list.deleteDescription", { name: s.name }),
      confirmLabel: t("common.delete"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteSupplier(s.id);
      toast.success(t("suppliers.list.deleted"));
      await mutate("suppliers");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t("common.error"));
    }
  };

  return (
    <div className="flex h-full">
      {/* Filters sidebar (same style as catalog / offers / library) */}
      {collapsed ? (
        <div className="hidden shrink-0 border-r border-border bg-card lg:flex">
          <button
            type="button"
            onClick={toggleCollapsed}
            className="flex h-full w-11 flex-col items-center gap-2 py-4 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
            title={t("suppliers.filters.show")}
            aria-label={t("suppliers.filters.show")}
          >
            <Faders size={18} />
            {activeCount > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-bold text-primary-foreground tabular-nums">
                {activeCount}
              </span>
            )}
          </button>
        </div>
      ) : (
        <aside className="hidden w-72 shrink-0 flex-col border-r border-border bg-card shadow-[var(--shadow-soft)] lg:flex">
          <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
            <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Faders size={16} weight="duotone" className="text-primary" />
              {t("suppliers.filters.title")}
              {activeCount > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground tabular-nums">
                  {activeCount}
                </span>
              )}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggleCollapsed}
              title={t("suppliers.filters.hide")}
              aria-label={t("suppliers.filters.hide")}
            >
              <SidebarSimple size={18} />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto overscroll-contain">
            <SuppliersFiltersSidebar filters={filters} onChange={setFilters} />
          </div>
        </aside>
      )}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-3 sm:px-6">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold tracking-tight text-foreground">{t("suppliers.title")}</h1>
            <p className="text-sm text-muted-foreground">
              {isLoading
                ? t("common.loading")
                : (suppliers?.length ?? 0) !== 1
                  ? t("suppliers.list.countOther", {
                      shown: rows.length,
                      total: suppliers?.length ?? 0,
                    })
                  : t("suppliers.list.countOne", {
                      shown: rows.length,
                      total: suppliers?.length ?? 0,
                    })}
            </p>
          </div>
          <SearchInput
            className="w-full sm:w-72"
            value={searchInput}
            onChange={onSearchChange}
            placeholder={t("suppliers.list.searchPlaceholder")}
          />
          {userCanEdit && (
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setWizardOpen(true)}>
                <AppIcon icon={CurrencyDollar} size="sm" />
                {t("suppliers.list.batchPrices")}
              </Button>
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                <AppIcon icon={UploadSimple} size="sm" />
                {t("suppliers.list.importPo")}
              </Button>
              <Button onClick={() => setModal("new")}>
                <AppIcon icon={Plus} size="sm" />
                {t("suppliers.list.newSupplier")}
              </Button>
            </div>
          )}
        </div>

        <SuppliersActiveFilterBar filters={filters} onChange={setFilters} onClearAll={resetFilters} />

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(s) => s.id}
              storageKey="suppliers-list"
              sort={sort}
              defaultSort={DEFAULT_SORT}
              onSort={(field) => setSort((s) => cycleSortField(field, s, DEFAULT_SORT))}
              isLoading={isLoading}
              onRowClick={(s) => router.push(`/suppliers/${s.id}`)}
              trailingWidth={userCanEdit ? 88 : undefined}
              renderTrailingCell={
                userCanEdit
                  ? (s) => (
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title={t("common.edit")}
                          onClick={(e) => {
                            e.stopPropagation();
                            setModal(s);
                          }}
                        >
                          <AppIcon icon={PencilSimple} size="sm" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title={t("common.delete")}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDelete(s);
                          }}
                        >
                          <AppIcon icon={Trash} size="sm" className="text-muted-foreground" />
                        </Button>
                      </div>
                    )
                  : undefined
              }
              errorState={
                error ? (
                  <EmptyState
                    className="border-none bg-transparent shadow-none"
                    icon={<AppIcon icon={Truck} size="lg" />}
                    title={t("suppliers.list.loadError")}
                  />
                ) : undefined
              }
              emptyState={
                <EmptyState
                  className="border-none bg-transparent shadow-none"
                  icon={<AppIcon icon={Truck} size="lg" />}
                  title={
                    activeCount > 0 ? t("suppliers.list.emptyFiltered") : t("suppliers.list.empty")
                  }
                  description={activeCount > 0 ? undefined : t("suppliers.list.emptyHint")}
                  action={
                    userCanEdit && activeCount === 0 ? (
                      <Button onClick={() => setModal("new")}>
                        <AppIcon icon={Plus} size="sm" />
                        {t("suppliers.list.newSupplier")}
                      </Button>
                    ) : undefined
                  }
                />
              }
            />
          </div>
        </div>
      </div>

      {modal !== null && (
        <SupplierModal
          supplier={modal === "new" ? undefined : modal}
          open
          onClose={() => setModal(null)}
        />
      )}

      {importOpen && <PoImportWizard open onClose={() => setImportOpen(false)} />}

      {wizardOpen && <BatchPriceWizard open onClose={() => setWizardOpen(false)} />}
    </div>
  );
}
