"use client";

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
  countActiveLibraryFilters,
  normalizeLibraryFilters,
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

const CATEGORIES: { code: string; label: string }[] = [
  { code: "cgv", label: "CGV" },
  { code: "warranty", label: "Garantie" },
  { code: "quality", label: "Qualité" },
  { code: "project_reference", label: "Références projet" },
  { code: "company", label: "Entreprise" },
  { code: "other", label: "Autre" },
];
const CAT_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.code, c.label]));
const LANGS = [
  { code: "", label: "Multi" },
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
  if (!res.ok) throw new Error("Erreur de chargement");
  return res.json();
}
function humanSize(b: number | null): string {
  if (!b) return "—";
  if (b < 1024) return `${b} o`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} Ko`;
  return `${(b / 1024 / 1024).toFixed(1)} Mo`;
}
function docLabel(d: Doc): string {
  return d.name?.fr || d.name?.en || d.file_name || "—";
}

const DEFAULT_SORT: DataTableSortState = { field: "file_name", dir: "asc" };
const PAGE_SIZE = 50;

// ── Upload dialog ─────────────────────────────────────────────────────────────

function UploadDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
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
    if (!ALLOWED_EXT.includes(ext)) return "Format non accepté (PDF, JPG, PNG, DOCX, XLSX).";
    if (f.size > MAX_BYTES) return "Fichier trop volumineux (max 20 Mo).";
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
        throw new Error(d?.detail ?? "Échec de l'upload.");
      }
      await mutate((k) => typeof k === "string" && k.startsWith("library:"));
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Échec de l'upload.");
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Ajouter un document</DialogTitle>
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
              {file.name} · {humanSize(file.size)}
            </span>
          ) : (
            <span>Glissez un fichier ici ou cliquez (PDF, JPG, PNG, DOCX, XLSX · max 20 Mo)</span>
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
          <FormField label="Catégorie">
            <FilterSelect
              value={category}
              onChange={setCategory}
              placeholder="Choisir…"
              options={CATEGORIES.map((c) => ({ value: c.code, label: c.label }))}
            />
          </FormField>
          <FormField label="Langue">
            <FilterSelect
              value={language}
              onChange={setLanguage}
              placeholder="Choisir…"
              options={LANGS.map((l) => ({ value: l.code, label: l.label }))}
            />
          </FormField>
        </div>

        <div className="relative">
          <FormField label="Produit lié (optionnel)">
            <Input
              value={productQuery}
              onChange={(e) => {
                setProductQuery(e.target.value);
                setProductId("");
              }}
              placeholder="Rechercher un SKU ou un nom…"
            />
          </FormField>
          {productId && (
            <span className="mt-1 inline-block text-xs text-brand-green">Produit lié ✓</span>
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

        <FormField label="Notes">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </FormField>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button type="button" onClick={submit} disabled={!file || busy}>
            {busy ? "Envoi…" : "Uploader"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Preview modal ─────────────────────────────────────────────────────────────

function PreviewDialog({ doc, onClose }: { doc: Doc; onClose: () => void }) {
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
              Aperçu indisponible pour ce format.
              <a href={doc.download_url} className="mt-2 block font-medium text-brand-green">
                Télécharger
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
  const { data } = useSWR<Doc[]>(`versions:${doc.id}`, () =>
    getJson<Doc[]>(`/api/document-library/${doc.id}/versions/`),
  );

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Versions — {doc.file_name}</DialogTitle>
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
                  · {new Date(v.created_at).toLocaleDateString("fr-FR")}
                </span>
              </span>
              <a href={v.download_url} className="text-xs font-medium text-brand-green">
                Télécharger
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
        title: "Supprimer le filtre favori",
        description: `Supprimer « ${sf.name} » de vos filtres sauvegardés ?`,
        confirmLabel: "Supprimer",
        destructive: true,
      });
      if (!ok) return;
      setSavedFilters((prev) => prev.filter((f) => f.id !== id));
    },
    [confirm, savedFilters],
  );

  const remove = async (d: Doc) => {
    const ok = await confirm({
      title: "Supprimer le document",
      description: `Supprimer « ${docLabel(d)} » ? (conservé 30 jours puis purgé)`,
      confirmLabel: "Supprimer",
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
        label: "Document",
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
        label: "Catégorie",
        width: 140,
        cellClassName: "text-sm text-muted-foreground",
        render: (d) => CAT_LABEL[d.category] ?? d.category,
      },
      {
        key: "language",
        label: "Langue",
        width: 80,
        cellClassName: "text-sm uppercase text-muted-foreground",
        render: (d) => d.language || "multi",
      },
      {
        key: "product",
        label: "Produit",
        width: 120,
        cellClassName: "text-sm text-muted-foreground",
        render: (d) => d.product_sku ?? "—",
      },
      {
        key: "version",
        label: "Ver.",
        width: 60,
        align: "right",
        sortField: "version",
        cellClassName: "text-sm text-muted-foreground font-data",
        render: (d) => `v${d.version}`,
      },
      {
        key: "size",
        label: "Taille",
        width: 80,
        align: "right",
        sortField: "file_size_bytes",
        cellClassName: "text-sm text-muted-foreground font-data",
        render: (d) => humanSize(d.file_size_bytes),
      },
    ],
    [],
  );

  return (
    <div className="flex h-full bg-background">
      {filtersCollapsed ? (
        <div className="relative hidden w-12 shrink-0 flex-col items-center border-r border-border bg-card py-3 shadow-[var(--shadow-soft)] lg:flex">
          <button
            type="button"
            onClick={() => setFiltersCollapsed(false)}
            className="relative rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Afficher les filtres"
            title="Filtres"
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
              <span className="text-sm font-bold text-foreground">Filtres</span>
              {activeFilterCount > 0 && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {activeFilterCount} critère{activeFilterCount > 1 ? "s actifs" : " actif"}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {activeFilterCount > 0 && (
                <Button type="button" variant="ghost" size="sm" onClick={resetFilters}>
                  Tout effacer
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setFiltersCollapsed(true)}
                aria-label="Masquer les filtres"
                title="Masquer les filtres"
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
            aria-label="Redimensionner le panneau des filtres"
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
                Bibliothèque de documents
              </h1>
              {!isLoading && (
                <p className="mt-0.5 text-sm tabular-nums text-muted-foreground">
                  {total.toLocaleString("fr-FR")} document{total !== 1 ? "s" : ""}
                </p>
              )}
            </div>
          </div>
          <Button onClick={() => setShowUpload(true)}>
            <Plus size={16} weight="bold" />
            <span className="hidden sm:inline">Ajouter</span>
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
              <IconBtn title="Aperçu" onClick={() => setPreview(d)}>
                <Eye size={15} />
              </IconBtn>
              <a
                href={d.download_url}
                title="Télécharger"
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent/50 hover:text-brand-green"
                onClick={(e) => e.stopPropagation()}
              >
                <DownloadSimple size={15} />
              </a>
              <IconBtn title="Versions" onClick={() => setVersions(d)}>
                <ClockCounterClockwise size={15} />
              </IconBtn>
              <IconBtn title="Supprimer" danger onClick={() => remove(d)}>
                <Trash size={15} />
              </IconBtn>
            </div>
          )}
          errorState={
            error ? (
              <EmptyState
                icon={<FileText size={24} weight="duotone" />}
                title="Erreur de chargement"
                description="Impossible de charger les documents."
              />
            ) : undefined
          }
          emptyState={
            <EmptyState
              icon={<FileText size={24} weight="duotone" />}
              title="Aucun document"
              description={
                activeFilterCount > 0
                  ? "Essayez d’élargir vos filtres."
                  : "Cliquez « Ajouter » pour en uploader un."
              }
              action={
                activeFilterCount > 0 ? (
                  <Button variant="outline" size="sm" onClick={resetFilters}>
                    Réinitialiser les filtres
                  </Button>
                ) : (
                  <Button onClick={() => setShowUpload(true)}>
                    <Plus size={16} weight="bold" />
                    Ajouter
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
                  itemLabel: "document",
                  jumpInputId: "library-page-jump",
                  ariaLabel: "Pagination des documents",
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
