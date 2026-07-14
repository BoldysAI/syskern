"use client";

import { useMemo, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, CheckCircle, Truck } from "@phosphor-icons/react";
import { AppModal } from "@/components/AppModal";
import { AppIcon } from "@/components/AppIcon";
import { SearchInput } from "@/components/SearchInput";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CatalogBrowser } from "@/app/catalog/_components/CatalogBrowser";
import { cn } from "@/lib/utils";
import {
  bulkUpdatePo,
  listSuppliers,
  type BulkPoMode,
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

  const reset = () => {
    setSupplier(initialSupplier ?? null);
    setStep(initialSupplier ? "skus" : "supplier");
    setSelected(new Map());
    setMode("set");
    setValue("");
    setResult(null);
    setSupplierSearch("");
  };

  const apply = async () => {
    if (!supplier) return;
    setApplying(true);
    try {
      const res = await bulkUpdatePo(supplier.id, {
        product_ids: [...selected.keys()],
        mode,
        value: String(numValue),
      });
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
        <div className="flex flex-col items-center gap-4 py-6 text-center">
          <AppIcon icon={CheckCircle} size="lg" weight="duotone" className="text-brand-green" />
          <div>
            <p className="text-base font-semibold text-foreground">Prix mis à jour</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {result.updated} SKU mis à jour
              {result.skipped > 0 ? ` · ${result.skipped} ignoré(s)` : ""}.
            </p>
          </div>
          <div className="flex gap-3">
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
            <div className="flex flex-col gap-3">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border border-border bg-muted/30 p-4 text-sm">
                <dt className="text-muted-foreground">Fournisseur</dt>
                <dd className="text-foreground">{supplier.name}</dd>
                <dt className="text-muted-foreground">SKU concernés</dt>
                <dd className="text-foreground">{selected.size}</dd>
                <dt className="text-muted-foreground">Opération</dt>
                <dd className="text-foreground">
                  {mode === "set"
                    ? `Définir le PO à ${numValue}`
                    : mode === "pct"
                      ? `Ajuster de ${numValue} %`
                      : `Ajuster de ${numValue}`}
                </dd>
              </dl>
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
              <Button disabled={applying} onClick={apply}>
                {applying ? "Application…" : `Appliquer à ${selected.size} SKU`}
              </Button>
            )}
          </div>
        </div>
      )}
    </AppModal>
  );
}
