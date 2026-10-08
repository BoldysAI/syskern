"use client";

import { useMemo, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  ArrowsInSimple,
  ArrowsOutSimple,
  CheckCircle,
  DownloadSimple,
  FileXls,
  FloppyDisk,
  Trash,
  Truck,
  Warning,
  WarningCircle,
} from "@phosphor-icons/react";
import { AppModal } from "@/components/AppModal";
import { AppIcon } from "@/components/AppIcon";
import { SearchInput } from "@/components/SearchInput";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge, type StatusBadgeProps } from "@/components/StatusBadge";
import { OptionSelect } from "@/components/OptionSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTable } from "@/components/data-table";
import type { DataTableColumnDef, DataTableSortState } from "@/components/data-table/types";
import { SuppliersFiltersSidebar } from "./SuppliersFiltersSidebar";
import { applySupplierFilters, type SupplierFilters } from "./supplier-filters";
import { cn } from "@/lib/utils";
import { useUiTranslate } from "@/lib/use-ui-translate";
import type { MessageKey } from "@/lib/i18n";
import {
  analyzePoImport,
  applyPoImport,
  deleteImportMapping,
  getTaskStatus,
  inspectPoImport,
  listImportMappings,
  listSuppliers,
  previewPoImport,
  saveImportMapping,
  type ImportColumnMap,
  type ImportMappableField,
  type PoImportAnalyzeResult,
  type PoImportPreview,
  type PoImportPreviewLine,
  type PoImportResult,
  type PoImportRowStatus,
  type Supplier,
  type SupplierImportMapping,
} from "@/lib/api";

type Step = "supplier" | "upload" | "mapping" | "review";

const NONE = "__none__";
const SUPPLIER_SORT: DataTableSortState = { field: "name", dir: "asc" };

/** Excel-style column label from a 0-based index (0→A, 26→AA). */
function columnLetter(index: number): string {
  let n = index;
  let label = "";
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

type UiTranslate = (key: MessageKey, vars?: Record<string, string | number>) => string;

function mappedColumnLabel(t: UiTranslate, index: number, header: string | undefined): string {
  const letter = columnLetter(index);
  if (header) return t("suppliers.poImport.columnWithHeader", { letter, header });
  return t("suppliers.poImport.column", { letter });
}

const FIELD_CONFIG: {
  key: ImportMappableField;
  labelKey: MessageKey;
  required: boolean;
  hintKey?: MessageKey;
}[] = [
  {
    key: "sku",
    labelKey: "suppliers.poImport.field.sku",
    required: true,
    hintKey: "suppliers.poImport.field.skuHint",
  },
  {
    key: "po",
    labelKey: "suppliers.poImport.field.po",
    required: true,
    hintKey: "suppliers.poImport.field.poHint",
  },
  {
    key: "supplier",
    labelKey: "suppliers.column.supplier",
    required: false,
    hintKey: "suppliers.poImport.field.supplierHint",
  },
  { key: "po_currency", labelKey: "suppliers.poImport.field.currency", required: false },
  { key: "factory_code", labelKey: "suppliers.detail.factoryCode", required: false },
  { key: "incoterm", labelKey: "suppliers.column.incoterm", required: false },
];

const STATUS_META: Record<
  PoImportRowStatus,
  { labelKey: MessageKey; variant: StatusBadgeProps["variant"] }
> = {
  will_update: { labelKey: "suppliers.status.willUpdate", variant: "success" },
  will_create_link: { labelKey: "suppliers.poImport.status.willCreateLink", variant: "info" },
  unchanged: { labelKey: "suppliers.poImport.status.unchanged", variant: "draft" },
  sku_not_found: { labelKey: "suppliers.poImport.status.skuNotFound", variant: "warning" },
  supplier_not_found: { labelKey: "suppliers.poImport.status.supplierNotFound", variant: "failed" },
  invalid_po: { labelKey: "suppliers.poImport.status.invalidPo", variant: "warning" },
  no_supplier: { labelKey: "suppliers.poImport.status.noSupplier", variant: "warning" },
  missing_sku: { labelKey: "suppliers.poImport.status.missingSku", variant: "warning" },
};

const STATUS_ORDER: PoImportRowStatus[] = [
  "will_update",
  "will_create_link",
  "unchanged",
  "sku_not_found",
  "supplier_not_found",
  "invalid_po",
  "no_supplier",
  "missing_sku",
];

function formatPoAmount(amount: string | null | undefined, currency?: string | null): string {
  if (amount == null || amount === "") return "—";
  const n = parseFloat(amount);
  if (!Number.isFinite(n)) return "—";
  const formatted = n.toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
  return currency ? `${formatted} ${currency}` : formatted;
}

export function PoImportWizard({
  open,
  onClose,
  initialSupplier,
}: {
  open: boolean;
  onClose: () => void;
  initialSupplier?: Supplier;
}) {
  const { mutate } = useSWRConfig();
  const t = useUiTranslate();

  const [step, setStep] = useState<Step>(initialSupplier ? "upload" : "supplier");
  const [supplier, setSupplier] = useState<Supplier | null>(initialSupplier ?? null);
  const [ignoreSupplier, setIgnoreSupplier] = useState(false);

  // Step 1 — supplier picker filters
  const [filters, setFilters] = useState<SupplierFilters>({});
  const [supplierSearch, setSupplierSearch] = useState("");

  // Step 2/3 — upload + analysis
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<PoImportAnalyzeResult | null>(null);
  const [headerRow, setHeaderRow] = useState(1);
  // Separate string state so the field can be cleared while typing (a bare
  // number input snaps back to "1" and blocks editing — poor UX).
  const [headerRowInput, setHeaderRowInput] = useState("1");
  const [inspecting, setInspecting] = useState(false);
  const [columnMap, setColumnMap] = useState<ImportColumnMap>({});

  // Mapping templates
  const [mappingName, setMappingName] = useState("");
  const [savingMapping, setSavingMapping] = useState(false);

  // Step 4 — preview + apply
  const [previewPhase, setPreviewPhase] = useState<"idle" | "running" | "done" | "error">("idle");
  const [preview, setPreview] = useState<PoImportPreview | null>(null);
  const [previewProgress, setPreviewProgress] = useState<{ current: number; total: number } | null>(
    null,
  );
  const [applyPhase, setApplyPhase] = useState<"idle" | "running" | "done" | "error">("idle");
  const [applyResult, setApplyResult] = useState<PoImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: suppliers, isLoading: suppliersLoading } = useSWR<Supplier[]>(
    step === "supplier" ? "suppliers" : null,
    () => listSuppliers(),
  );

  const mappingScope = supplier?.id;
  const { data: mappings, mutate: mutateMappings } = useSWR<SupplierImportMapping[]>(
    step === "mapping" ? ["import-mappings", mappingScope ?? "all"] : null,
    () => listImportMappings(mappingScope),
  );

  const supplierRows = useMemo(() => {
    const withSearch: SupplierFilters = { ...filters, q: supplierSearch || undefined };
    return applySupplierFilters(suppliers ?? [], withSearch);
  }, [suppliers, filters, supplierSearch]);

  const supplierColumns = useMemo<DataTableColumnDef<Supplier>[]>(
    () => [
      {
        key: "name",
        label: t("suppliers.column.supplier"),
        width: 260,
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
        width: 90,
        render: (s) => <span className="font-data text-sm text-foreground">{s.currency_default}</span>,
      },
      {
        key: "incoterm_default",
        label: t("suppliers.column.incoterm"),
        width: 110,
        render: (s) => (
          <span className="text-sm text-muted-foreground">{s.incoterm_default || "—"}</span>
        ),
      },
      {
        key: "linked_skus_count",
        label: t("suppliers.column.linkedSkus"),
        width: 100,
        align: "right",
        render: (s) => (
          <span className="font-data text-sm text-foreground">{s.linked_skus_count ?? 0}</span>
        ),
      },
    ],
    [t],
  );

  const requiredOk = columnMap.sku != null && columnMap.po != null;
  const supplierResolvable = Boolean(supplier) || columnMap.supplier != null;
  const mappingValid = requiredOk && supplierResolvable;

  const previewLines = useMemo(() => {
    const lines = [...(preview?.lines ?? [])];
    lines.sort((a, b) => {
      const d = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
      if (d !== 0) return d;
      return a.row - b.row;
    });
    return lines;
  }, [preview?.lines]);

  const resetAll = () => {
    setStep(initialSupplier ? "upload" : "supplier");
    setSupplier(initialSupplier ?? null);
    setIgnoreSupplier(false);
    setFilters({});
    setSupplierSearch("");
    setFile(null);
    setAnalysis(null);
    setHeaderRow(1);
    setHeaderRowInput("1");
    setColumnMap({});
    setMappingName("");
    setPreview(null);
    setPreviewPhase("idle");
    setPreviewProgress(null);
    setApplyResult(null);
    setApplyPhase("idle");
    setError(null);
  };

  const pickFile = (f: File | null) => {
    if (!f) return;
    if (!/\.(xlsx|xlsm)$/i.test(f.name)) {
      setError(t("suppliers.poImport.badFormat"));
      return;
    }
    setError(null);
    setFile(f);
  };

  const runAnalyze = async () => {
    if (!file) return;
    setAnalyzing(true);
    setError(null);
    try {
      const res = await analyzePoImport(file, headerRow);
      setAnalysis(res);
      setHeaderRow(res.header_row);
      setHeaderRowInput(String(res.header_row));
      // Best-effort auto-mapping by header label similarity.
      setColumnMap((prev) => (Object.keys(prev).length ? prev : autoMap(res.headers)));
      setStep("mapping");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("suppliers.poImport.analyzeError"));
    } finally {
      setAnalyzing(false);
    }
  };

  const changeHeaderRow = async (nextRow: number) => {
    const row = Math.max(1, Math.floor(nextRow) || 1);
    setHeaderRow(row);
    setHeaderRowInput(String(row));
    if (!analysis) return;
    setInspecting(true);
    setError(null);
    try {
      const res = await inspectPoImport({ upload_token: analysis.upload_token, header_row: row });
      setAnalysis({ ...analysis, ...res });
      // Drop any mapped column now out of range for the new layout.
      setColumnMap((prev) => {
        const next: ImportColumnMap = {};
        for (const [k, v] of Object.entries(prev)) {
          if (typeof v === "number" && v < res.column_count) next[k as ImportMappableField] = v;
        }
        return next;
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("suppliers.poImport.rereadError"));
    } finally {
      setInspecting(false);
    }
  };

  const setField = (field: ImportMappableField, value: string | null) => {
    setColumnMap((prev) => {
      const next = { ...prev };
      if (value == null || value === NONE) delete next[field];
      else next[field] = Number(value);
      return next;
    });
  };

  const applyMappingTemplate = async (m: SupplierImportMapping) => {
    if (!analysis) return;
    // Re-read the file with the template's header row if it differs.
    let columnCount = analysis.column_count;
    if (m.header_row !== headerRow) {
      setInspecting(true);
      try {
        const res = await inspectPoImport({
          upload_token: analysis.upload_token,
          header_row: m.header_row,
        });
        setAnalysis({ ...analysis, ...res });
        setHeaderRow(res.header_row);
        setHeaderRowInput(String(res.header_row));
        columnCount = res.column_count;
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : t("common.error"));
        setInspecting(false);
        return;
      }
      setInspecting(false);
    }
    // Keep only indices still in range for the current layout.
    const next: ImportColumnMap = {};
    for (const [k, v] of Object.entries(m.column_map)) {
      if (typeof v === "number" && v >= 0 && v < columnCount) next[k as ImportMappableField] = v;
    }
    setColumnMap(next);
    toast.success(t("suppliers.poImport.mappingLoaded", { name: m.name }));
  };

  const saveMapping = async () => {
    const name = mappingName.trim();
    if (!name) {
      toast.error(t("suppliers.poImport.mappingNameRequired"));
      return;
    }
    if (!requiredOk) {
      toast.error(t("suppliers.poImport.mappingRequiredFields"));
      return;
    }
    setSavingMapping(true);
    try {
      await saveImportMapping({
        name,
        supplier: supplier?.id ?? null,
        column_map: columnMap,
        header_row: headerRow,
      });
      toast.success(t("suppliers.poImport.mappingSaved"));
      setMappingName("");
      await mutateMappings();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setSavingMapping(false);
    }
  };

  const removeMapping = async (m: SupplierImportMapping) => {
    try {
      await deleteImportMapping(m.id);
      toast.success(t("suppliers.poImport.mappingDeleted"));
      await mutateMappings();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t("common.error"));
    }
  };

  const pollTask = async <T,>(
    taskId: string,
    onProgress: (p: { current: number; total: number }) => void,
  ): Promise<T> => {
    const start = Date.now();
    while (Date.now() - start < 600_000) {
      const s = await getTaskStatus<T>(taskId);
      if (s.progress) onProgress(s.progress);
      if (s.status === "SUCCESS") return s.result as T;
      if (s.status === "FAILURE") throw new Error(s.error || t("suppliers.poImport.taskFailed"));
      await new Promise((r) => setTimeout(r, 800));
    }
    throw new Error(t("suppliers.poImport.timeout"));
  };

  const runPreview = async () => {
    setStep("review");
    setPreviewPhase("running");
    setPreview(null);
    setPreviewProgress(null);
    setApplyResult(null);
    setApplyPhase("idle");
    setError(null);
    try {
      const { task_id } = await previewPoImport({
        upload_token: analysis!.upload_token,
        column_map: columnMap,
        supplier_id: supplier?.id ?? null,
        header_row: headerRow,
      });
      const res = await pollTask<PoImportPreview>(task_id, setPreviewProgress);
      setPreview(res);
      setPreviewPhase("done");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("common.error"));
      setPreviewPhase("error");
    }
  };

  const runApply = async () => {
    if (!analysis) return;
    setApplyPhase("running");
    setError(null);
    try {
      const { task_id } = await applyPoImport({
        upload_token: analysis.upload_token,
        column_map: columnMap,
        supplier_id: supplier?.id ?? null,
        header_row: headerRow,
      });
      const res = await pollTask<PoImportResult>(task_id, () => {});
      setApplyResult(res);
      setApplyPhase("done");
      await mutate("suppliers");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("common.error"));
      setApplyPhase("error");
    }
  };

  const downloadReport = () => {
    if (!applyResult?.report_url) return;
    const link = document.createElement("a");
    link.href = applyResult.report_url;
    link.click();
  };

  const stepTitles: Record<Step, string> = {
    supplier: t("suppliers.wizard.chooseSupplier"),
    upload: t("suppliers.poImport.stepUpload"),
    mapping: t("suppliers.poImport.stepMapping"),
    review: t("suppliers.poImport.stepReview"),
  };

  const willApplyCount = preview
    ? preview.summary.will_update + preview.summary.will_create_link
    : 0;

  return (
    <AppModal
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={t("suppliers.poImport.title")}
      description={
        supplier
          ? supplier.name
          : ignoreSupplier
            ? t("suppliers.poImport.multiSupplierFile")
            : t("suppliers.poImport.assistant")
      }
      size="full"
    >
      {applyResult && applyPhase === "done" ? (
        <ApplyResultView
          result={applyResult}
          onDownload={downloadReport}
          onReset={resetAll}
          onClose={onClose}
        />
      ) : (
        <div className="flex h-full flex-col gap-4">
          <p className="text-sm font-medium text-foreground">{stepTitles[step]}</p>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <AppIcon icon={WarningCircle} size="sm" />
              <span>{error}</span>
            </div>
          )}

          {/* ── Step 1 — supplier ─────────────────────────────────────────── */}
          {step === "supplier" && (
            <div className="flex min-h-0 flex-1 gap-3">
              <aside className="hidden w-64 shrink-0 flex-col overflow-y-auto rounded-lg border border-border bg-card lg:flex">
                <SuppliersFiltersSidebar filters={filters} onChange={setFilters} />
              </aside>
              <div className="flex min-h-0 flex-1 flex-col gap-3">
                <div className="flex items-center gap-3">
                  <SearchInput
                    className="flex-1"
                    value={supplierSearch}
                    onChange={setSupplierSearch}
                    placeholder={t("suppliers.wizard.searchSupplier")}
                  />
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSupplier(null);
                      setIgnoreSupplier(true);
                      setStep("upload");
                    }}
                  >
                    {t("suppliers.poImport.ignoreMulti")}
                  </Button>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border">
                  <DataTable
                    columns={supplierColumns}
                    rows={supplierRows}
                    rowKey={(s) => s.id}
                    storageKey="po-import-supplier-picker"
                    sort={SUPPLIER_SORT}
                    defaultSort={SUPPLIER_SORT}
                    onSort={() => {}}
                    isLoading={suppliersLoading}
                    onRowClick={(s) => {
                      setSupplier(s);
                      setIgnoreSupplier(false);
                      setStep("upload");
                    }}
                    emptyState={
                      <EmptyState
                        className="border-none bg-transparent shadow-none"
                        icon={<AppIcon icon={Truck} size="lg" />}
                        title={t("suppliers.list.empty")}
                      />
                    }
                  />
                </div>
              </div>
            </div>
          )}

          {/* ── Step 2 — upload ───────────────────────────────────────────── */}
          {step === "upload" && (
            <div className="flex flex-col gap-4">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
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
                disabled={analyzing}
                className={cn(
                  "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors",
                  dragOver ? "border-primary bg-primary/5" : "border-border bg-muted/30",
                  analyzing && "opacity-60",
                )}
              >
                <AppIcon icon={FileXls} size="lg" className="text-muted-foreground" />
                {file ? (
                  <span className="text-sm font-medium text-foreground">{file.name}</span>
                ) : (
                  <>
                    <span className="text-sm font-medium text-foreground">
                      {t("suppliers.poImport.drop")}
                    </span>
                    <span className="text-xs text-muted-foreground">{t("suppliers.poImport.formats")}</span>
                  </>
                )}
                <input
                  ref={inputRef}
                  type="file"
                  accept=".xlsx,.xlsm"
                  className="hidden"
                  onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                />
              </button>
              <p className="text-sm text-muted-foreground">
                {t("suppliers.poImport.anyStructure")}
              </p>
            </div>
          )}

          {/* ── Step 3 — mapping ──────────────────────────────────────────── */}
          {step === "mapping" && analysis && (
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
              <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/20 p-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                    {t("suppliers.poImport.headerRow")}
                  </label>
                  <Input
                    type="text"
                    inputMode="numeric"
                    className="w-24"
                    value={headerRowInput}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/[^0-9]/g, "");
                      setHeaderRowInput(digits);
                      const n = parseInt(digits, 10);
                      if (!Number.isNaN(n) && n >= 1 && n !== headerRow) void changeHeaderRow(n);
                    }}
                    onBlur={() => {
                      const n = parseInt(headerRowInput, 10);
                      if (Number.isNaN(n) || n < 1) setHeaderRowInput(String(headerRow));
                    }}
                    disabled={inspecting}
                  />
                </div>
                <p className="flex-1 text-xs text-muted-foreground">
                  {t("suppliers.poImport.headerHint")}
                  {inspecting && t("suppliers.poImport.rereading")}
                </p>
              </div>

              <MappingTemplates
                mappings={mappings ?? []}
                onApply={(m) => void applyMappingTemplate(m)}
                onRemove={removeMapping}
              />

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {FIELD_CONFIG.map((f) => {
                  const options = [
                    { value: NONE, label: t("suppliers.poImport.doNotMap") },
                    ...Array.from({ length: analysis.column_count }, (_, i) => ({
                      value: String(i),
                      label: mappedColumnLabel(t, i, analysis.headers[i]),
                    })),
                  ];
                  return (
                    <div key={f.key} className="flex flex-col gap-1">
                      <label className="text-sm font-medium text-foreground">
                        {t(f.labelKey)}
                        {f.required && <span className="ml-1 text-destructive">*</span>}
                      </label>
                      <OptionSelect
                        value={columnMap[f.key] != null ? String(columnMap[f.key]) : NONE}
                        onValueChange={(v) => setField(f.key, v)}
                        options={options}
                        placeholder={t("suppliers.poImport.doNotMap")}
                      />
                      {f.hintKey && (
                        <span className="text-xs text-muted-foreground">{t(f.hintKey)}</span>
                      )}
                    </div>
                  );
                })}
              </div>

              {!supplierResolvable && (
                <div className="flex items-start gap-2 rounded-lg border border-warm/40 bg-warm/10 px-4 py-3 text-sm text-foreground">
                  <Warning size={18} className="mt-0.5 shrink-0 text-warm" weight="fill" />
                  <p>{t("suppliers.poImport.noSupplierMapped")}</p>
                </div>
              )}

              <SamplePreview
                headers={analysis.headers}
                rows={analysis.sample_rows}
                headerRowNumber={analysis.header_row}
              />

              <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-muted/30 p-3">
                <div className="flex-1">
                  <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                    {t("suppliers.poImport.saveMappingLabel")}
                  </label>
                  <Input
                    value={mappingName}
                    onChange={(e) => setMappingName(e.target.value)}
                    placeholder={t("suppliers.poImport.mappingNamePlaceholder")}
                  />
                </div>
                <Button
                  variant="outline"
                  onClick={saveMapping}
                  disabled={savingMapping || !mappingName.trim() || !requiredOk}
                >
                  <AppIcon icon={FloppyDisk} size="sm" />
                  {t("common.save")}
                </Button>
              </div>
            </div>
          )}

          {/* ── Step 4 — review ───────────────────────────────────────────── */}
          {step === "review" && (
            <div className="flex min-h-0 flex-1 flex-col gap-4">
              {previewPhase === "running" && (
                <div className="flex flex-col gap-1.5">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full animate-pulse rounded-full bg-primary"
                      style={{
                        width: previewProgress
                          ? `${Math.round((previewProgress.current / Math.max(previewProgress.total, 1)) * 100)}%`
                          : "40%",
                      }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">{t("suppliers.poImport.analyzingLines")}</p>
                </div>
              )}

              {previewPhase === "done" && preview && (
                <>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                    <SummaryStat label={t("suppliers.poImport.total")} value={preview.summary.total} />
                    <SummaryStat label={t("suppliers.summary.updated")} value={preview.summary.will_update} highlight />
                    <SummaryStat label={t("suppliers.poImport.linksCreated")} value={preview.summary.will_create_link} highlight />
                    <SummaryStat label={t("suppliers.summary.unchanged")} value={preview.summary.unchanged} />
                    <SummaryStat label={t("suppliers.poImport.unknownSkus")} value={preview.summary.sku_not_found} />
                    <SummaryStat label={t("suppliers.poImport.rejected")} value={preview.summary.rejected} />
                  </div>

                  {willApplyCount === 0 && (
                    <div className="flex items-start gap-2 rounded-lg border border-warm/40 bg-warm/10 px-4 py-3 text-sm text-foreground">
                      <Warning size={18} className="mt-0.5 shrink-0 text-warm" weight="fill" />
                      <p>{t("suppliers.poImport.noneApplied")}</p>
                    </div>
                  )}

                  <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border">
                    <div className="shrink-0 border-b border-border bg-muted/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {preview.summary.total > previewLines.length
                        ? t("suppliers.poImport.detailCountOf", {
                            count: previewLines.length,
                            total: preview.summary.total,
                          })
                        : t("suppliers.poImport.detailCount", { count: previewLines.length })}
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto">
                      <table className="w-full min-w-[720px] text-sm">
                        <thead className="sticky top-0 z-10 bg-card text-xs text-muted-foreground shadow-sm">
                          <tr>
                            <th className="px-4 py-2.5 text-left font-semibold">{t("suppliers.column.line")}</th>
                            <th className="px-4 py-2.5 text-left font-semibold">{t("suppliers.column.sku")}</th>
                            <th className="px-4 py-2.5 text-left font-semibold">{t("suppliers.column.supplier")}</th>
                            <th className="px-4 py-2.5 text-right font-semibold">{t("suppliers.column.oldPo")}</th>
                            <th className="px-4 py-2.5 text-right font-semibold">{t("suppliers.column.newPo")}</th>
                            <th className="px-4 py-2.5 text-left font-semibold">{t("suppliers.column.status")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {previewLines.map((line) => (
                            <PreviewRow key={`${line.row}-${line.sku}`} line={line} />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Footer nav ────────────────────────────────────────────────── */}
          <div className="mt-auto flex items-center justify-between border-t border-border pt-4">
            <Button
              variant="ghost"
              disabled={
                (step === "supplier") ||
                (step === "upload" && Boolean(initialSupplier)) ||
                applyPhase === "running"
              }
              onClick={() => {
                if (step === "review") setStep("mapping");
                else if (step === "mapping") setStep("upload");
                else if (step === "upload") setStep("supplier");
              }}
            >
              <AppIcon icon={ArrowLeft} size="sm" />
              {t("common.back")}
            </Button>

            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={onClose} disabled={applyPhase === "running"}>
                {t("common.cancel")}
              </Button>

              {step === "upload" && (
                <Button onClick={runAnalyze} disabled={!file || analyzing}>
                  {analyzing ? t("suppliers.poImport.analyzing") : t("suppliers.wizard.continue")}
                  <AppIcon icon={ArrowRight} size="sm" />
                </Button>
              )}
              {step === "mapping" && (
                <Button onClick={runPreview} disabled={!mappingValid}>
                  {t("suppliers.poImport.seeSummary")}
                  <AppIcon icon={ArrowRight} size="sm" />
                </Button>
              )}
              {step === "review" && (
                <Button
                  onClick={runApply}
                  disabled={
                    previewPhase !== "done" || applyPhase === "running" || willApplyCount === 0
                  }
                >
                  {applyPhase === "running"
                    ? t("suppliers.wizard.applying")
                    : t("suppliers.poImport.confirmCount", { count: willApplyCount })}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </AppModal>
  );
}

function autoMap(headers: string[]): ImportColumnMap {
  const norm = (s: string) => s.trim().toLowerCase();
  const findIdx = (candidates: string[]) =>
    headers.findIndex((h) => h && candidates.some((c) => norm(h) === c || norm(h).includes(c)));
  const map: ImportColumnMap = {};
  const assign = (field: ImportMappableField, candidates: string[]) => {
    const idx = findIdx(candidates);
    if (idx >= 0) map[field] = idx;
  };
  assign("sku", ["sku", "référence", "reference", "item", "code produit"]);
  assign("po", ["po", "prix", "price", "achat"]);
  assign("supplier", ["fournisseur", "supplier"]);
  assign("po_currency", ["devise", "currency"]);
  assign("incoterm", ["incoterm"]);
  return map;
}

function PreviewRow({ line }: { line: PoImportPreviewLine }) {
  const t = useUiTranslate();
  const meta = STATUS_META[line.status];
  const actionable = line.status === "will_update" || line.status === "will_create_link";
  return (
    <tr className={cn("border-t border-border/60", actionable && "bg-primary/5")}>
      <td className="px-4 py-2.5 font-data text-muted-foreground">{line.row}</td>
      <td className="px-4 py-2.5 font-mono text-foreground">{line.sku || "—"}</td>
      <td className="max-w-[12rem] truncate px-4 py-2.5 text-muted-foreground">
        {line.supplier || "—"}
      </td>
      <td className="px-4 py-2.5 text-right font-data text-muted-foreground">
        {formatPoAmount(line.old_po_base_price, line.po_currency)}
      </td>
      <td className="px-4 py-2.5 text-right font-data font-medium text-foreground">
        {formatPoAmount(line.new_po_base_price, line.po_currency)}
      </td>
      <td className="px-4 py-2.5">
        <StatusBadge variant={meta.variant} title={line.reason || undefined}>
          {t(meta.labelKey)}
        </StatusBadge>
      </td>
    </tr>
  );
}

function MappingTemplates({
  mappings,
  onApply,
  onRemove,
}: {
  mappings: SupplierImportMapping[];
  onApply: (m: SupplierImportMapping) => void;
  onRemove: (m: SupplierImportMapping) => void;
}) {
  const t = useUiTranslate();
  if (mappings.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/20 p-3">
      <span className="text-xs font-semibold text-muted-foreground">
        {t("suppliers.poImport.savedMappings")}
      </span>
      {mappings.map((m) => (
        <span
          key={m.id}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-card py-1 pl-2.5 pr-1 text-sm"
        >
          <button
            type="button"
            className="font-medium text-foreground hover:text-primary"
            onClick={() => onApply(m)}
          >
            {m.name}
          </button>
          <button
            type="button"
            className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-destructive"
            title={t("suppliers.poImport.deleteMapping")}
            onClick={() => onRemove(m)}
          >
            <Trash size={14} />
          </button>
        </span>
      ))}
    </div>
  );
}

function SamplePreview({
  headers,
  rows,
  headerRowNumber,
}: {
  headers: string[];
  rows: string[][];
  headerRowNumber: number;
}) {
  const t = useUiTranslate();
  const [expanded, setExpanded] = useState(false);
  if (rows.length === 0) return null;
  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border">
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-muted/40 px-4 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {rows.length === 1
            ? t("suppliers.poImport.sampleOne", { count: rows.length })
            : t("suppliers.poImport.sampleOther", { count: rows.length })}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={() => setExpanded((v) => !v)}
        >
          <AppIcon icon={expanded ? ArrowsInSimple : ArrowsOutSimple} size="sm" />
          {expanded ? t("suppliers.poImport.collapse") : t("suppliers.poImport.expand")}
        </Button>
      </div>
      <div className={cn("overflow-auto", expanded ? "max-h-[65vh]" : "max-h-80")}>
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-card text-xs text-muted-foreground shadow-sm">
            <tr>
              <th className="sticky left-0 z-20 w-14 bg-card px-3 py-2 text-right font-semibold">
                {t("suppliers.column.line")}
              </th>
              {headers.map((h, i) => (
                <th key={i} className="whitespace-nowrap px-3 py-2 text-left font-semibold">
                  {mappedColumnLabel(t, i, h)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} className="border-t border-border/60">
                <td className="sticky left-0 z-10 w-14 bg-card px-3 py-1.5 text-right font-data text-xs text-muted-foreground">
                  {headerRowNumber + 1 + ri}
                </td>
                {headers.map((_, ci) => (
                  <td key={ci} className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                    {row[ci] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ApplyResultView({
  result,
  onDownload,
  onReset,
  onClose,
}: {
  result: PoImportResult;
  onDownload: () => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const t = useUiTranslate();
  return (
    <div className="flex flex-col gap-5 py-4">
      <div className="flex flex-col items-center gap-3 text-center">
        <AppIcon icon={CheckCircle} size="lg" weight="duotone" className="text-brand-green" />
        <div>
          <p className="text-base font-semibold text-foreground">{t("suppliers.poImport.done")}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {result.rejected > 0
              ? t("suppliers.poImport.resultRejected", {
                  updated: result.updated,
                  created: result.created,
                  rejected: result.rejected,
                })
              : t("suppliers.poImport.result", {
                  updated: result.updated,
                  created: result.created,
                })}
          </p>
        </div>
      </div>

      <div className="mx-auto grid w-full max-w-2xl grid-cols-3 gap-3">
        <SummaryStat label={t("suppliers.summary.updated")} value={result.updated} highlight />
        <SummaryStat label={t("suppliers.poImport.linksCreated")} value={result.created} highlight />
        <SummaryStat label={t("suppliers.poImport.rejected")} value={result.rejected} />
      </div>

      {result.rejected > 0 && result.report_url && (
        <div className="mx-auto w-full max-w-2xl rounded-lg border border-border bg-muted/40 p-3 text-center">
          <p className="text-sm text-muted-foreground">
            {t("suppliers.poImport.rejectedLines", { count: result.rejected })}
          </p>
          <Button variant="outline" size="sm" className="mt-2" onClick={onDownload}>
            <AppIcon icon={DownloadSimple} size="sm" />
            {t("suppliers.poImport.downloadReport")}
          </Button>
        </div>
      )}

      <div className="flex justify-center gap-3">
        <Button variant="outline" onClick={onReset}>
          {t("suppliers.poImport.newImport")}
        </Button>
        <Button onClick={onClose}>{t("common.close")}</Button>
      </div>
    </div>
  );
}

function SummaryStat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2.5",
        highlight ? "border-primary/30 bg-primary/5" : "border-border bg-card",
      )}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 text-xl font-semibold tabular-nums",
          highlight ? "text-primary" : "text-foreground",
        )}
      >
        {value}
      </p>
    </div>
  );
}
