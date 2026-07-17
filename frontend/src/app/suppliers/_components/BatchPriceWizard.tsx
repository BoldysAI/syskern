"use client";

import { useMemo, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, CheckCircle, Truck, Warning } from "@phosphor-icons/react";
import { AppModal } from "@/components/AppModal";
import { AppIcon } from "@/components/AppIcon";
import { SearchInput } from "@/components/SearchInput";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { CatalogBrowser } from "@/app/catalog/_components/CatalogBrowser";
import { cn } from "@/lib/utils";
import {
  bulkUpdatePo,
  listSuppliers,
  previewBulkPo,
  type BulkPoMode,
  type BulkPoPreview,
  type BulkPoPreviewLine,
  type BulkPoResult,
  type Product,
  type Supplier,
} from "@/lib/api";

const MODE_OPTIONS: { value: BulkPoMode; label: string; hint: string }[] = [
  { value: "set", label: "Définir une valeur", hint: "Fixe le même PO pour les SKU sélectionnés" },
  { value: "pct", label: "Ajustement en %", hint: "ex. 5 = +5 %, -5 = −5 %" },
  { value: "abs", label: "Ajustement en montant", hint: "ex. 1.5 = +1.5, -1.5 = −1.5" },
];

type Step = "supplier" | "skus" | "change" | "review";

function formatPoAmount(amount: string | null | undefined, currency?: string): string {
  if (amount == null || amount === "") return "—";
  const n = parseFloat(amount);
  if (!Number.isFinite(n)) return "—";
  const formatted = n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return currency ? `${formatted} ${currency}` : formatted;
}

function describeBulkPoOperation(mode: BulkPoMode, numValue: number): string {
  const v = numValue.toLocaleString("fr-FR", { maximumFractionDigits: 4 });
  if (mode === "set") return `Fixer le PO base à ${v}`;
  if (mode === "pct") return `Ajuster le PO de ${v} %`;
  return `Ajuster le PO de ${v} (montant signé)`;
}

function previewStatusLabel(status: BulkPoPreviewLine["status"]): string {
  switch (status) {
    case "will_update":
      return "Sera mis à jour";
    case "skip_no_po":
      return "Ignoré — PO absent";
    case "skip_unchanged":
      return "Ignoré — inchangé";
    default:
      return status;
  }
}

function previewStatusVariant(
  status: BulkPoPreviewLine["status"],
): "success" | "warning" | "draft" {
  if (status === "will_update") return "success";
  if (status === "skip_no_po") return "warning";
  return "draft";
}

function poDeltaLabel(oldPrice: string | null, newPrice: string | null): string | null {
  if (oldPrice == null || newPrice == null) return null;
  const oldN = parseFloat(oldPrice);
  const newN = parseFloat(newPrice);
  if (!Number.isFinite(oldN) || !Number.isFinite(newN)) return null;
  const delta = newN - oldN;
  if (delta === 0) return "0";
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

export function BatchPriceWizard({
  open,
  onClose,
  initialSupplier,
  onApplied,
}: {
  open: boolean;
  onClose: () => void;
  initialSupplier?: Supplier;
  onApplied?: () => void | Promise<void>;
}) {
  const { mutate } = useSWRConfig();
  const [supplier, setSupplier] = useState<Supplier | null>(initialSupplier ?? null);
  const [step, setStep] = useState<Step>(initialSupplier ? "skus" : "supplier");
  const [supplierSearch, setSupplierSearch] = useState("");
  const [selected, setSelected] = useState<Map<string, string>>(new Map());
  const [mode, setMode] = useState<BulkPoMode>("set");
  const [value, setValue] = useState("");
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<BulkPoResult | null>(null);
  const [appliedPreview, setAppliedPreview] = useState<BulkPoPreview | null>(null);

  const { data: suppliers } = useSWR<Supplier[]>(
    step === "supplier" ? "suppliers" : null,
    () => listSuppliers(),
  );

  const filteredSuppliers = useMemo(() => {
    const q = supplierSearch.trim().toLowerCase();
    const rows = suppliers ?? [];
    if (!q) return rows;
    return rows.filter(
      (s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q),
    );
  }, [suppliers, supplierSearch]);

  const selectedIds = useMemo(() => new Set(selected.keys()), [selected]);

  const toggleRow = (p: Product) => {
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
        if (select) next.set(p.id, p.sku_code);
        else next.delete(p.id);
      }
      return next;
    });
  };

  const numValue = Number(value.replace(",", "."));
  const valueValid =
    value.trim() !== "" && !Number.isNaN(numValue) && (mode !== "set" || numValue >= 0);

  const selectedProductIds = useMemo(() => [...selected.keys()].sort(), [selected]);

  const previewKey =
    step === "review" && supplier && valueValid && selectedProductIds.length > 0
      ? ["bulk-po-preview", supplier.id, mode, value, selectedProductIds.join(",")]
      : null;

  const { data: preview, isLoading: previewLoading, error: previewError } = useSWR(
    previewKey,
    () =>
      previewBulkPo(supplier!.id, {
        product_ids: selectedProductIds,
        mode,
        value: String(numValue),
      }),
  );

  const previewLines = useMemo(() => {
    const lines = [...(preview?.lines ?? [])];
    lines.sort((a, b) => {
      const rank = (s: BulkPoPreviewLine["status"]) =>
        s === "will_update" ? 0 : s === "skip_no_po" ? 1 : 2;
      const d = rank(a.status) - rank(b.status);
      if (d !== 0) return d;
      return a.product_sku.localeCompare(b.product_sku);
    });
    return lines;
  }, [preview?.lines]);

  const reset = () => {
    setSupplier(initialSupplier ?? null);
    setStep(initialSupplier ? "skus" : "supplier");
    setSelected(new Map());
    setMode("set");
    setValue("");
    setResult(null);
    setAppliedPreview(null);
    setSupplierSearch("");
  };

  const apply = async () => {
    if (!supplier || !preview) return;
    setApplying(true);
    try {
      const res = await bulkUpdatePo(supplier.id, {
        product_ids: selectedProductIds,
        mode,
        value: String(numValue),
      });
      setAppliedPreview(preview);
      setResult(res);
      await Promise.all([
        mutate((k) => Array.isArray(k) && k[0] === `supplier-catalog:${supplier.id}`),
        mutate(`supplier-skus:${supplier.id}`),
        mutate(`supplier-history:${supplier.id}`),
        mutate("suppliers"),
      ]);
      await onApplied?.();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setApplying(false);
    }
  };

  const stepTitles: Record<Step, string> = {
    supplier: "1 · Choisir le fournisseur",
    skus: "2 · Sélectionner les SKU",
    change: "3 · Définir le changement",
    review: "4 · Récapitulatif",
  };

  return (
    <AppModal
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Modifier les prix en batch"
      description={supplier ? supplier.name : "Assistant de mise à jour des PO"}
      size="full"
    >
      {result ? (
        <div className="flex flex-col gap-5 py-4">
          <div className="flex flex-col items-center gap-3 text-center">
            <AppIcon icon={CheckCircle} size="lg" weight="duotone" className="text-brand-green" />
            <div>
              <p className="text-base font-semibold text-foreground">Prix mis à jour</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {result.updated} SKU mis à jour
                {result.skipped > 0 ? ` · ${result.skipped} ignoré(s)` : ""}.
              </p>
            </div>
          </div>

          {appliedPreview && (
            <div className="mx-auto w-full max-w-3xl space-y-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <SummaryStat label="Mis à jour" value={appliedPreview.summary.will_update} highlight />
                <SummaryStat label="PO absent" value={appliedPreview.summary.skip_no_po} />
                <SummaryStat label="Inchangés" value={appliedPreview.summary.skip_unchanged} />
                <SummaryStat label="Sélection" value={appliedPreview.summary.selected} />
              </div>
              {appliedPreview.lines.filter((l) => l.status === "will_update").length > 0 && (
                <div className="overflow-hidden rounded-lg border border-border">
                  <div className="border-b border-border bg-muted/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Changements appliqués
                  </div>
                  <div className="max-h-56 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
                        <tr>
                          <th className="px-4 py-2 text-left font-semibold">SKU</th>
                          <th className="px-4 py-2 text-right font-semibold">Ancien PO</th>
                          <th className="px-4 py-2 text-right font-semibold">Nouveau PO</th>
                        </tr>
                      </thead>
                      <tbody>
                        {appliedPreview.lines
                          .filter((l) => l.status === "will_update")
                          .map((line) => (
                            <tr key={line.link_id} className="border-t border-border/60">
                              <td className="px-4 py-2 font-mono text-foreground">{line.product_sku}</td>
                              <td className="px-4 py-2 text-right font-data text-muted-foreground">
                                {formatPoAmount(line.old_po_base_price, line.po_currency)}
                              </td>
                              <td className="px-4 py-2 text-right font-data font-medium text-foreground">
                                {formatPoAmount(line.new_po_base_price, line.po_currency)}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-center gap-3">
            <Button variant="outline" onClick={reset}>
              Nouveau lot
            </Button>
            <Button onClick={onClose}>Fermer</Button>
          </div>
        </div>
      ) : (
        <div className="flex h-full flex-col gap-4">
          <p className="text-sm font-medium text-foreground">{stepTitles[step]}</p>

          {step === "supplier" && (
            <div className="flex flex-col gap-3">
              <SearchInput
                value={supplierSearch}
                onChange={setSupplierSearch}
                placeholder="Rechercher un fournisseur…"
              />
              <div className="max-h-80 overflow-y-auto rounded-lg border border-border">
                {filteredSuppliers.length === 0 ? (
                  <EmptyState
                    className="border-none bg-transparent shadow-none"
                    icon={<AppIcon icon={Truck} size="lg" />}
                    title="Aucun fournisseur"
                  />
                ) : (
                  filteredSuppliers.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        setSupplier(s);
                        setSelected(new Map());
                        setStep("skus");
                      }}
                      className="flex w-full items-center justify-between border-b border-border/60 px-4 py-2.5 text-left last:border-0 hover:bg-muted/50"
                    >
                      <span className="text-sm font-medium text-foreground">{s.name}</span>
                      <span className="font-data text-xs text-muted-foreground">
                        {s.linked_skus_count ?? 0} SKU
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {step === "skus" && supplier && (
            <div className="flex min-h-0 flex-1 flex-col gap-2">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Filtrez comme dans le catalogue, puis cochez les SKU à repricer.
                </p>
                <span className="text-sm font-medium text-foreground">
                  {selected.size} sélectionné{selected.size !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="flex min-h-0 flex-1">
                <CatalogBrowser
                  className="flex-1 rounded-lg"
                  variant="embedded"
                  swrKey={`batch-wizard-catalog:${supplier.id}`}
                  pageSize={50}
                  density="compact"
                  skuAsLink={false}
                  enableSavedFilters={false}
                  title="SKU du fournisseur"
                  initialFilters={{ supplier: [supplier.name] }}
                  filtersCollapsedStorageKey="syskern:batch-wizard-filters-collapsed"
                  filtersWidthStorageKey="syskern:batch-wizard-filters-width"
                  paginationJumpInputId="batch-wizard-page"
                  selectedIds={selectedIds}
                  onToggleProduct={toggleRow}
                  onTogglePageProducts={togglePage}
                  onToggleFilteredProducts={toggleFiltered}
                />
              </div>
            </div>
          )}

          {step === "change" && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {MODE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setMode(opt.value)}
                    className={cn(
                      "rounded-lg border p-3 text-left transition-colors",
                      mode === opt.value
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/50",
                    )}
                  >
                    <div className="text-sm font-medium text-foreground">{opt.label}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{opt.hint}</div>
                  </button>
                ))}
              </div>
              <div className="flex-1">
                <label className="mb-1.5 block text-sm font-semibold text-foreground">
                  {mode === "set" ? "Nouveau PO" : mode === "pct" ? "Pourcentage" : "Montant"}
                </label>
                <Input
                  inputMode="decimal"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={mode === "pct" ? "ex. 5 ou -5" : "ex. 12.50"}
                />
              </div>
              <p className="text-sm text-muted-foreground">
                {selected.size} SKU sélectionné{selected.size !== 1 ? "s" : ""}. Les SKU sans PO seront
                ignorés pour les ajustements % / montant.
              </p>
            </div>
          )}

          {step === "review" && supplier && (
            <div className="flex min-h-0 flex-1 flex-col gap-4">
              <div className="rounded-lg border border-border bg-muted/30 p-4">
                <dl className="grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Fournisseur
                    </dt>
                    <dd className="mt-0.5 font-medium text-foreground">{supplier.name}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Devise par défaut
                    </dt>
                    <dd className="mt-0.5 font-data text-foreground">
                      {supplier.currency_default || "—"}
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Opération
                    </dt>
                    <dd className="mt-0.5 text-foreground">{describeBulkPoOperation(mode, numValue)}</dd>
                  </div>
                </dl>
              </div>

              {previewLoading ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-16 rounded-lg" />
                  ))}
                </div>
              ) : previewError ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  Impossible de charger l&apos;aperçu. Revenez à l&apos;étape précédente puis réessayez.
                </div>
              ) : preview ? (
                <>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <SummaryStat label="Seront mis à jour" value={preview.summary.will_update} highlight />
                    <SummaryStat label="PO absent" value={preview.summary.skip_no_po} />
                    <SummaryStat label="Inchangés" value={preview.summary.skip_unchanged} />
                    <SummaryStat label="Sélectionnés" value={preview.summary.selected} />
                  </div>

                  {preview.summary.will_update === 0 && (
                    <div className="flex items-start gap-2 rounded-lg border border-warm/40 bg-warm/10 px-4 py-3 text-sm text-foreground">
                      <Warning size={18} className="mt-0.5 shrink-0 text-warm" weight="fill" />
                      <p>
                        Aucun SKU ne sera modifié avec ces paramètres. Ajustez la sélection ou
                        l&apos;opération avant d&apos;appliquer.
                      </p>
                    </div>
                  )}

                  {preview.summary.not_linked > 0 && (
                    <p className="text-sm text-warm">
                      {preview.summary.not_linked} SKU sélectionné(s) sans lien fournisseur — ignorés.
                    </p>
                  )}

                  <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border">
                    <div className="shrink-0 border-b border-border bg-muted/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Détail par SKU ({previewLines.length})
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto">
                      <table className="w-full min-w-[640px] text-sm">
                        <thead className="sticky top-0 z-10 bg-card text-xs text-muted-foreground shadow-sm">
                          <tr>
                            <th className="px-4 py-2.5 text-left font-semibold">SKU</th>
                            <th className="px-4 py-2.5 text-left font-semibold">Désignation</th>
                            <th className="px-4 py-2.5 text-right font-semibold">Ancien PO</th>
                            <th className="px-4 py-2.5 text-right font-semibold">Nouveau PO</th>
                            <th className="px-4 py-2.5 text-right font-semibold">Écart</th>
                            <th className="px-4 py-2.5 text-left font-semibold">Statut</th>
                          </tr>
                        </thead>
                        <tbody>
                          {previewLines.map((line) => {
                            const delta = poDeltaLabel(
                              line.old_po_base_price,
                              line.new_po_base_price,
                            );
                            return (
                              <tr
                                key={line.link_id}
                                className={cn(
                                  "border-t border-border/60",
                                  line.status === "will_update" && "bg-primary/5",
                                )}
                              >
                                <td className="px-4 py-2.5 font-mono text-foreground">
                                  {line.product_sku}
                                </td>
                                <td className="max-w-[12rem] truncate px-4 py-2.5 text-muted-foreground">
                                  {line.product_name}
                                </td>
                                <td className="px-4 py-2.5 text-right font-data text-muted-foreground">
                                  {formatPoAmount(line.old_po_base_price, line.po_currency)}
                                </td>
                                <td className="px-4 py-2.5 text-right font-data font-medium text-foreground">
                                  {formatPoAmount(line.new_po_base_price, line.po_currency)}
                                </td>
                                <td
                                  className={cn(
                                    "px-4 py-2.5 text-right font-data tabular-nums",
                                    delta?.startsWith("+")
                                      ? "text-brand-green"
                                      : delta?.startsWith("-")
                                        ? "text-destructive"
                                        : "text-muted-foreground",
                                  )}
                                >
                                  {delta ?? "—"}
                                </td>
                                <td className="px-4 py-2.5">
                                  <StatusBadge variant={previewStatusVariant(line.status)}>
                                    {previewStatusLabel(line.status)}
                                  </StatusBadge>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          )}

          {/* Footer nav */}
          <div className="mt-auto flex items-center justify-between border-t border-border pt-4">
            <Button
              variant="ghost"
              disabled={step === "supplier" || (step === "skus" && Boolean(initialSupplier))}
              onClick={() => {
                if (step === "review") setStep("change");
                else if (step === "change") setStep("skus");
                else if (step === "skus") setStep("supplier");
              }}
            >
              <AppIcon icon={ArrowLeft} size="sm" />
              Retour
            </Button>

            {step === "skus" && (
              <Button disabled={selected.size === 0} onClick={() => setStep("change")}>
                Continuer
                <AppIcon icon={ArrowRight} size="sm" />
              </Button>
            )}
            {step === "change" && (
              <Button disabled={!valueValid} onClick={() => setStep("review")}>
                Continuer
                <AppIcon icon={ArrowRight} size="sm" />
              </Button>
            )}
            {step === "review" && (
              <Button
                disabled={
                  applying || previewLoading || !preview || preview.summary.will_update === 0
                }
                onClick={apply}
              >
                {applying
                  ? "Application…"
                  : preview
                    ? `Appliquer à ${preview.summary.will_update} SKU`
                    : "Appliquer"}
              </Button>
            )}
          </div>
        </div>
      )}
    </AppModal>
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
