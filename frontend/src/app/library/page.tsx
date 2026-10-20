"use client";

import { useAuth } from "@/contexts/AuthContext";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR, { mutate } from "swr";
import {
  DownloadSimple,
  Eye,
  Faders,
  FileText,
  ClockCounterClockwise,
  Plus,
  SidebarSimple,
  Trash,
  UploadSimple,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { useUiTranslate } from "@/lib/use-ui-translate";
import { getApiLocale } from "@/lib/api";
import { translate, uiDateLocale, type MessageKey } from "@/lib/i18n";
import { useConfirm } from "@/components/ConfirmProvider";
import { usePersistedBoolean } from "@/hooks/usePersistedBoolean";
import { useResizableWidth } from "@/hooks/useResizableWidth";
import { EmptyState } from "@/components/EmptyState";
import { FilterSelect } from "@/components/FilterSelect";
import { FormField } from "@/components/FormField";
import { DataTable } from "@/components/data-table";
import type { DataTableColumnDef, DataTableSortState } from "@/components/data-table/types";
import { cycleSortField } from "@/components/data-table/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LibraryFiltersSidebar } from "./_components/LibraryFiltersSidebar";
import { LibraryActiveFilterBar } from "./_components/LibraryActiveFilterBar";
import { LibraryFilterSheet, LibraryFilterTrigger } from "./_components/LibraryFilterSheet";
import {
  buildLibraryQuery,
  CATEGORY_OPTIONS,
  countActiveLibraryFilters,
  normalizeLibraryFilters,
  translateOptionLabel,
  type LibraryFilters,
} from "./_components/library-filters";
import {
  loadSavedLibraryFilters,
  persistSavedLibraryFilters,
  type SavedLibraryFilter,
} from "./_components/filters-storage";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// ── Types ────────────────────────────────────────────────────────────────────

interface Doc {
  id: string;
  name: Record<string, string>;
  category: string;
  language: string;
  file_name: string;
  file_size_bytes: number | null;
  mime_type: string;
  version: number;
  product: string | null;
  product_sku: string | null;
  product_name: string | null;
  description: string;
  download_url: string;
  created_at: string;
}
interface Paginated<T> {
  count: number;
  results: T[];
}
interface ProductLite {
  id: string;
  sku_code: string;
  name: string;
}

const LANGS = [
  { code: "fr", label: "FR" },
  { code: "en", label: "EN" },
  { code: "es", label: "ES" },
];
const MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED_EXT = [".pdf", ".jpg", ".jpeg", ".png", ".docx", ".xlsx"];

function getCsrfToken(): string {
  if (typeof document === "undefined") return "";
  const m = document.cookie.match(/csrftoken=([^;]+)/);
  return m ? m[1] : "";
}
async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(translate("library.error.title", getApiLocale()));
  return res.json();
}
function humanSize(
  b: number | null,
  t: (key: MessageKey, vars?: Record<string, string | number>) => string,
): string {
  if (!b) return "—";
  if (b < 1024) return t("library.size.bytes", { count: b });
  if (b < 1024 * 1024) return t("library.size.kb", { count: (b / 1024).toFixed(0) });
  return t("library.size.mb", { count: (b / 1024 / 1024).toFixed(1) });
}
function docLabel(d: Doc): string {
  return d.name?.fr || d.name?.en || d.file_name || "—";
}

const DEFAULT_SORT: DataTableSortState = { field: "file_name", dir: "asc" };
const PAGE_SIZE = 50;

// ── Upload dialog ─────────────────────────────────────────────────────────────

function UploadDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useUiTranslate();
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState("cgv");
  const [language, setLanguage] = useState("fr");
  const [productQuery, setProductQuery] = useState("");
  const [productId, setProductId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: productsResp } = useSWR(open ? "products:lite" : null, () =>
    getJson<Paginated<ProductLite> | ProductLite[]>("/api/products/?limit=1000"),
  );
  const products = useMemo<ProductLite[]>(
    () => (Array.isArray(productsResp) ? productsResp : (productsResp?.results ?? [])),
    [productsResp],
  );
  const productMatches = useMemo(() => {
    const q = productQuery.trim().toLowerCase();
    if (!q || productId) return [];
    return products
      .filter((p) => p.sku_code.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
      .slice(0, 6);
  }, [productQuery, productId, products]);

  const validate = (f: File): string | null => {
    const ext = f.name.slice(f.name.lastIndexOf(".")).toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) return t("library.upload.format_rejected");
    if (f.size > MAX_BYTES) return t("library.upload.too_large");
    return null;
  };
  const pickFile = (f: File | null) => {
    if (!f) return;
    const err = validate(f);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setFile(f);
  };

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("category", category);
      fd.append("language", language);
      if (productId) fd.append("product", productId);
      if (notes) fd.append("description", notes);
      fd.append("name", JSON.stringify({ fr: file.name }));
      const res = await fetch("/api/document-library/upload/", {
        method: "POST",
        credentials: "include",
        headers: { "X-CSRFToken": getCsrfToken() },
        body: fd,
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.detail ?? t("library.upload.failed"));
      }
      await mutate((k) => typeof k === "string" && k.startsWith("library:"));
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("library.upload.failed"));
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("library.upload.title")}</DialogTitle>
        </DialogHeader>

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            pickFile(e.dataTransfer.files?.[0] ?? null);
          }}
          onClick={() => inputRef.current?.click()}
          className={cn(
            "flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 text-center text-sm",
            dragOver ? "border-primary bg-accent" : "border-border text-muted-foreground",
          )}
        >
          <UploadSimple size={22} className="text-muted-foreground" />
          {file ? (
            <span className="font-medium text-foreground">
              {file.name} · {humanSize(file.size, t)}
            </span>
          ) : (
            <span>{t("library.upload.drop")}</span>
          )}
          <input
            ref={inputRef}
            type="file"
            accept={ALLOWED_EXT.join(",")}
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField label={t("library.category")}>
            <FilterSelect
              value={category}
              onChange={setCategory}
              placeholder={t("library.upload.choose")}
              options={CATEGORY_OPTIONS.map((c) => ({ value: c.value, label: t(c.labelKey) }))}
            />
          </FormField>
          <FormField label={t("library.language")}>
            <FilterSelect
              value={language}
              onChange={setLanguage}
              placeholder={t("library.upload.choose")}
              options={[
                { value: "", label: t("library.language.multi") },
                ...LANGS.map((l) => ({ value: l.code, label: l.label })),
              ]}
            />
          </FormField>
        </div>

        <div className="relative">
          <FormField label={t("library.upload.product")}>
            <Input
              value={productQuery}
              onChange={(e) => {
                setProductQuery(e.target.value);
                setProductId("");
              }}
              placeholder={t("library.upload.product_placeholder")}
            />
          </FormField>
          {productId && (
            <span className="mt-1 inline-block text-xs text-brand-green">
              {t("library.upload.product_linked")}
            </span>
          )}
          {productMatches.length > 0 && (
            <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
              {productMatches.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setProductId(p.id);
                    setProductQuery(`${p.sku_code} — ${p.name}`);
                  }}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-muted/50"
                >
                  <span className="font-medium">{p.sku_code}</span>{" "}
                  <span className="text-muted-foreground">{p.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <FormField label={t("library.upload.notes")}>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </FormField>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="button" onClick={submit} disabled={!file || busy}>
            {busy ? t("library.upload.sending") : t("library.upload.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Preview modal ─────────────────────────────────────────────────────────────

function PreviewDialog({ doc, onClose }: { doc: Doc; onClose: () => void }) {
  const t = useUiTranslate();
  const isImage = doc.mime_type.startsWith("image/");
  const isPdf = doc.mime_type === "application/pdf";
  const src = `${doc.download_url}?inline=1`;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex h-[90vh] w-[92vw] max-w-6xl flex-col gap-3 p-4">
        <DialogHeader>
          <DialogTitle className="truncate pr-8">{docLabel(doc)}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-1 items-center justify-center overflow-auto rounded-lg bg-muted/30">
          {isPdf ? (
            <iframe src={src} title={docLabel(doc)} className="h-full w-full rounded-lg border-0" />
          ) : isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt={docLabel(doc)} className="max-h-full max-w-full object-contain" />
          ) : (
            <div className="text-center text-sm text-muted-foreground">
              <FileText
                size={40}
                weight="duotone"
                className="mx-auto mb-2 text-muted-foreground/50"
              />
              {t("library.preview.unavailable")}
              <a href={doc.download_url} className="mt-2 block font-medium text-brand-green">
                {t("library.download")}
              </a>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Versions dialog ───────────────────────────────────────────────────────────

function VersionsDialog({ doc, onClose }: { doc: Doc; onClose: () => void }) {
  const { displayLanguage } = useAuth();
  const t = useUiTranslate();
  const { data } = useSWR<Doc[]>(`versions:${doc.id}`, () =>
    getJson<Doc[]>(`/api/document-library/${doc.id}/versions/`),
  );

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("library.versions.title", { name: doc.file_name })}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          {(data ?? []).map((v) => (
            <div
              key={v.id}
              className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
            >
              <span>
                <span className="font-data font-medium">v{v.version}</span>{" "}
                <span className="text-muted-foreground">
                  · {new Date(v.created_at).toLocaleDateString(uiDateLocale(displayLanguage))}
                </span>
              </span>
              <a href={v.download_url} className="text-xs font-medium text-brand-green">
                {t("library.download")}
              </a>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function LibraryPage() {
  const { displayLanguage } = useAuth();
  const t = useUiTranslate();
  const confirm = useConfirm();
  const [filters, setFilters] = useState<LibraryFilters>({});
  const [showUpload, setShowUpload] = useState(false);
  const [preview, setPreview] = useState<Doc | null>(null);
  const [versions, setVersions] = useState<Doc | null>(null);
  const [sort, setSort] = useState<DataTableSortState>(DEFAULT_SORT);
  const [page, setPage] = useState(1);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const [filtersCollapsed, setFiltersCollapsed] = usePersistedBoolean(
    "syskern:library-filters-collapsed",
    false,
  );
  const {
    width: filterSidebarWidth,
    startResize: startFilterResize,
    isResizing: isFilterResizing,
  } = useResizableWidth(300, {
    min: 240,
    max: 420,
    storageKey: "syskern:library-filters-width",
  });

  const [savedFilters, setSavedFilters] = useState<SavedLibraryFilter[]>(loadSavedLibraryFilters);
  useEffect(() => {
    persistSavedLibraryFilters(savedFilters);
  }, [savedFilters]);

  const ordering = `${sort.dir === "desc" ? "-" : ""}${sort.field}`;
  const query = useMemo(
    () =>
      buildLibraryQuery(filters, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, ordering }),
    [filters, ordering, page],
  );

  const { data, isLoading, error } = useSWR<Paginated<Doc>>(`library:${query}`, () =>
    getJson<Paginated<Doc>>(`/api/document-library/?${query}`),
  );
  const docs = data?.results ?? [];
  const total = data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const activeFilterCount = countActiveLibraryFilters(filters);

  const applyFilters = useCallback((next: LibraryFilters) => {
    setFilters(next);
    setPage(1);
  }, []);
  const resetFilters = () => {
    setFilters({});
    setPage(1);
  };

  const onSaveFilter = (name: string) => {
    const id = typeof crypto !== "undefined" ? crypto.randomUUID() : String(Date.now());
    setSavedFilters((prev) => [...prev, { id, name, filters }]);
  };
  const onApplyFilter = (sf: SavedLibraryFilter) => setFilters(normalizeLibraryFilters(sf.filters));
  const onDeleteFilter = useCallback(
    async (id: string) => {
      const sf = savedFilters.find((f) => f.id === id);
      if (!sf) return;
      const ok = await confirm({
        title: t("library.filters.delete_favorite_title"),
        description: t("library.filters.delete_favorite_description", { name: sf.name }),
        confirmLabel: t("common.delete"),
        destructive: true,
      });
      if (!ok) return;
      setSavedFilters((prev) => prev.filter((f) => f.id !== id));
    },
    [confirm, savedFilters, t],
  );

  const remove = async (d: Doc) => {
    const ok = await confirm({
      title: t("library.delete.title"),
      description: t("library.delete.description", { name: docLabel(d) }),
      confirmLabel: t("common.delete"),
      destructive: true,
    });
    if (!ok) return;
    await fetch(`/api/document-library/${d.id}/`, {
      method: "DELETE",
      credentials: "include",
      headers: { "X-CSRFToken": getCsrfToken() },
    });
    mutate(`library:${query}`);
  };

  const columns = useMemo<DataTableColumnDef<Doc>[]>(
    () => [
      {
        key: "name",
        label: t("library.column.document"),
        width: 240,
        sortField: "file_name",
        render: (d) => (
          <div>
            <div className="text-sm font-medium text-foreground">{docLabel(d)}</div>
            <div className="text-xs text-muted-foreground">{d.file_name}</div>
          </div>
        ),
      },
      {
        key: "category",
        label: t("library.category"),
        width: 140,
        cellClassName: "text-sm text-muted-foreground",
        render: (d) => translateOptionLabel(CATEGORY_OPTIONS, d.category, t),
      },
      {
        key: "language",
        label: t("library.language"),
        width: 80,
        cellClassName: "text-sm uppercase text-muted-foreground",
        render: (d) => d.language || t("library.language.unspecified"),
      },
      {
        key: "product",
        label: t("library.column.product"),
        width: 120,
        cellClassName: "text-sm text-muted-foreground",
        render: (d) => d.product_sku ?? "—",
      },
      {
        key: "version",
        label: t("library.column.version"),
        width: 60,
        align: "right",
        sortField: "version",
        cellClassName: "text-sm text-muted-foreground font-data",
        render: (d) => `v${d.version}`,
      },
      {
        key: "size",
        label: t("library.column.size"),
        width: 80,
        align: "right",
        sortField: "file_size_bytes",
        cellClassName: "text-sm text-muted-foreground font-data",
        render: (d) => humanSize(d.file_size_bytes, t),
      },
    ],
    [t],
  );

  return (
    <div className="flex h-full bg-background">
      {filtersCollapsed ? (
        <div className="relative hidden w-12 shrink-0 flex-col items-center border-r border-border bg-card py-3 shadow-[var(--shadow-soft)] lg:flex">
          <button
            type="button"
            onClick={() => setFiltersCollapsed(false)}
            className="relative rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={t("library.filters.show")}
            title={t("library.filters.title")}
          >
            <Faders size={18} weight="duotone" />
            {activeFilterCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>
      ) : (
        <aside
          className="relative hidden shrink-0 flex-col border-r border-border bg-card shadow-[var(--shadow-soft)] lg:flex"
          style={{ width: filterSidebarWidth }}
        >
          <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-card px-4 py-4">
            <div className="min-w-0">
              <span className="text-sm font-bold text-foreground">{t("library.filters.title")}</span>
              {activeFilterCount > 0 && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {activeFilterCount > 1
                    ? t("library.filters.active_other", { count: activeFilterCount })
                    : t("library.filters.active_one", { count: activeFilterCount })}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {activeFilterCount > 0 && (
                <Button type="button" variant="ghost" size="sm" onClick={resetFilters}>
                  {t("library.filters.clear_all")}
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setFiltersCollapsed(true)}
                aria-label={t("library.filters.hide")}
                title={t("library.filters.hide")}
              >
                <SidebarSimple size={18} />
              </Button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto overscroll-contain">
            <LibraryFiltersSidebar
              filters={filters}
              onChange={applyFilters}
              savedFilters={savedFilters}
              onSaveFilter={onSaveFilter}
              onApplyFilter={onApplyFilter}
              onDeleteFilter={onDeleteFilter}
            />
          </div>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t("library.filters.resize")}
            onMouseDown={startFilterResize}
            className={cn(
              "absolute right-0 top-0 z-20 flex h-full w-1.5 cursor-col-resize touch-none items-center justify-center transition-colors",
              "hover:bg-primary/20",
              isFilterResizing && "bg-primary/30",
            )}
          >
            <span className="h-10 w-0.5 rounded-full bg-border" />
          </div>
        </aside>
      )}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border bg-card px-4 py-4 shadow-[var(--shadow-soft)] sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <LibraryFilterTrigger
              activeCount={activeFilterCount}
              onClick={() => setMobileFiltersOpen(true)}
            />
            <div className="min-w-0">
              <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight text-foreground sm:text-xl">
                <FileText size={22} weight="duotone" className="shrink-0 text-primary" />
                {t("library.title")}
              </h1>
              {!isLoading && (
                <p className="mt-0.5 text-sm tabular-nums text-muted-foreground">
                  {total !== 1
                    ? t("library.count.other", { count: total.toLocaleString(uiDateLocale(displayLanguage)) })
                    : t("library.count.one", { count: total.toLocaleString(uiDateLocale(displayLanguage)) })}
                </p>
              )}
            </div>
          </div>
          <Button onClick={() => setShowUpload(true)}>
            <Plus size={16} weight="bold" />
            <span className="hidden sm:inline">{t("library.add")}</span>
          </Button>
        </div>

        <LibraryFilterSheet
          open={mobileFiltersOpen}
          onOpenChange={setMobileFiltersOpen}
          filters={filters}
          onChange={applyFilters}
          onReset={resetFilters}
          savedFilters={savedFilters}
          onSaveFilter={onSaveFilter}
          onApplyFilter={onApplyFilter}
          onDeleteFilter={onDeleteFilter}
        />

        <LibraryActiveFilterBar
          filters={filters}
          onChange={applyFilters}
          onClearAll={resetFilters}
        />

        <DataTable
          columns={columns}
          rows={docs}
          rowKey={(d) => d.id}
          storageKey="library-list"
          sort={sort}
          defaultSort={DEFAULT_SORT}
          onSort={(field) => {
            setPage(1);
            setSort((s) => cycleSortField(field, s, DEFAULT_SORT));
          }}
          isLoading={isLoading}
          trailingWidth={140}
          renderTrailingCell={(d) => (
            <div className="flex items-center justify-end gap-0.5">
              <IconBtn title={t("library.preview.action")} onClick={() => setPreview(d)}>
                <Eye size={15} />
              </IconBtn>
              <a
                href={d.download_url}
                title={t("library.download")}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent/50 hover:text-brand-green"
                onClick={(e) => e.stopPropagation()}
              >
                <DownloadSimple size={15} />
              </a>
              <IconBtn title={t("library.versions.action")} onClick={() => setVersions(d)}>
                <ClockCounterClockwise size={15} />
              </IconBtn>
              <IconBtn title={t("common.delete")} danger onClick={() => remove(d)}>
                <Trash size={15} />
              </IconBtn>
            </div>
          )}
          errorState={
            error ? (
              <EmptyState
                icon={<FileText size={24} weight="duotone" />}
                title={t("library.error.title")}
                description={t("library.error.description")}
              />
            ) : undefined
          }
          emptyState={
            <EmptyState
              icon={<FileText size={24} weight="duotone" />}
              title={t("library.empty.title")}
              description={
                activeFilterCount > 0
                  ? t("library.empty.filtered")
                  : t("library.empty.default")
              }
              action={
                activeFilterCount > 0 ? (
                  <Button variant="outline" size="sm" onClick={resetFilters}>
                    {t("library.empty.reset")}
                  </Button>
                ) : (
                  <Button onClick={() => setShowUpload(true)}>
                    <Plus size={16} weight="bold" />
                    {t("library.add")}
                  </Button>
                )
              }
            />
          }
          pagination={
            total > PAGE_SIZE
              ? {
                  page,
                  totalPages,
                  totalCount: total,
                  pageSize: PAGE_SIZE,
                  onPageChange: setPage,
                  itemLabel: t("library.pagination.item"),
                  jumpInputId: "library-page-jump",
                  ariaLabel: t("library.pagination.aria"),
                }
              : undefined
          }
        />
      </div>

      <UploadDialog open={showUpload} onClose={() => setShowUpload(false)} />
      {preview && <PreviewDialog doc={preview} onClose={() => setPreview(null)} />}
      {versions && <VersionsDialog doc={versions} onClose={() => setVersions(null)} />}
    </div>
  );
}

function IconBtn({
  children,
  title,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "rounded-lg p-1.5 text-muted-foreground transition-colors",
        danger
          ? "hover:bg-destructive/10 hover:text-destructive"
          : "hover:bg-accent/50 hover:text-brand-green",
      )}
    >
      {children}
    </button>
  );
}
