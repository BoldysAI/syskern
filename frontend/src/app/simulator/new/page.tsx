"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { CaretLeft, CaretRight, CircleNotch } from "@phosphor-icons/react";
import { addSimulationLines, createSimulation } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useUiTranslate } from "@/lib/use-ui-translate";
import type { MessageKey } from "@/lib/i18n";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { ParamsStep } from "./_components/ParamsStep";
import { SkuStep } from "./_components/SkuStep";
import { TypeStep } from "./_components/TypeStep";
import { WizardCreateWarningsDialog } from "./_components/WizardCreateWarningsDialog";
import {
  buildSimulationPatch,
  clearDraft,
  collectWizardCreateWarnings,
  collectWizardStep3Issues,
  clearCatalogSeed,
  catalogDraft,
  emptyDraft,
  loadDraft,
  normalizeIntegerQuantity,
  persistDraft,
  peekCatalogSeed,
  resolveSelectedSkusByProductIds,
  step1Valid,
  withSelectedSkuDefaults,
  type WizardCreateWarning,
  type WizardDraft,
} from "./_components/wizard-draft";

const STEPS: { id: number; label: MessageKey }[] = [
  { id: 1, label: "simulator.wizard.stepType" },
  { id: 2, label: "simulator.wizard.stepSku" },
  { id: 3, label: "simulator.wizard.stepParams" },
];

export default function NewSimulationPage() {
  const t = useUiTranslate();
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>}>
      <NewSimulationPageContent />
    </Suspense>
  );
}

function NewSimulationPageContent() {
  const router = useRouter();
  const t = useUiTranslate();
  const { displayLanguage } = useAuth();
  const searchParams = useSearchParams();
  const fromCatalog = searchParams.get("from") === "catalog";
  const catalogProductIds = searchParams.get("product_ids") ?? "";

  const [draft, setDraft] = useState<WizardDraft>(emptyDraft);
  const [ready, setReady] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createWarnings, setCreateWarnings] = useState<WizardCreateWarning[] | null>(null);
  const catalogInitDoneRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      if (fromCatalog) {
        if (catalogInitDoneRef.current) {
          if (!cancelled) setReady(true);
          return;
        }

        const seed = peekCatalogSeed();
        const urlIds = catalogProductIds.split(",").map((id) => id.trim()).filter(Boolean);
        const productIds = seed?.productIds.length ? seed.productIds : urlIds;

        if (!productIds.length) {
          if (!cancelled) {
            setSeedError(t("simulator.wizard.noCatalogSeed"));
            setDraft(emptyDraft());
            setReady(true);
          }
          return;
        }

        catalogInitDoneRef.current = true;

        if (seed?.selectedSkus?.length) {
          if (!cancelled) {
            setDraft(catalogDraft(seed.selectedSkus.map(withSelectedSkuDefaults)));
            setReady(true);
          }
          return;
        }

        try {
          const selectedSkus = await resolveSelectedSkusByProductIds(
            productIds,
            seed?.selectedSkus ?? [],
          );
          if (cancelled) return;
          if (selectedSkus.length === 0) {
            setSeedError(t("simulator.wizard.catalogLoadFailed"));
            setDraft(emptyDraft());
          } else {
            setDraft(catalogDraft(selectedSkus.map(withSelectedSkuDefaults)));
          }
        } catch {
          if (cancelled) return;
          setSeedError(t("simulator.wizard.catalogLoadFailed"));
          setDraft(emptyDraft());
        } finally {
          if (!cancelled) setReady(true);
        }
        return;
      }

      if (!cancelled) {
        setDraft(loadDraft());
        setReady(true);
      }
    };

    void init();
    return () => {
      cancelled = true;
    };
  }, [fromCatalog, catalogProductIds, t]);

  useEffect(() => {
    if (!ready || fromCatalog) return;
    persistDraft(draft);
  }, [draft, ready, fromCatalog]);

  const update = (patch: Partial<WizardDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const step1Ok = step1Valid(draft);
  const step3Issues = useMemo(
    () => collectWizardStep3Issues(draft, displayLanguage),
    [draft, displayLanguage],
  );
  const catalogSkuCount = fromCatalog ? draft.selectedSkus.length : 0;

  const canSubmit = step1Ok && !saving && ready;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      const sim = await createSimulation(buildSimulationPatch(draft));
      if (draft.selectedSkus.length > 0) {
        await addSimulationLines(
          sim.id,
          draft.selectedSkus.map((s) => ({
            product_id: s.id,
            quantity: normalizeIntegerQuantity(s.quantity),
          })),
        );
      }
      clearDraft();
      if (fromCatalog) clearCatalogSeed();
      router.push(`/simulator/${sim.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("simulator.wizard.createFailed"));
      setSaving(false);
    }
  };

  const goNext = async () => {
    if (step === 1 && !step1Ok) return;
    if (step === 3) {
      const warnings = collectWizardCreateWarnings(draft, displayLanguage);
      if (warnings.length > 0) {
        setCreateWarnings(warnings);
        return;
      }
    }
    setError(null);
    if (step < 3) setStep((s) => s + 1);
    else void handleSubmit();
  };

  if (!ready) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center p-6 text-sm text-muted-foreground">
        <CircleNotch size={20} className="mr-2 animate-spin" />
        {t("simulator.wizard.preparing")}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col",
        step === 2 ? "h-[calc(100dvh-3.5rem)] overflow-hidden" : "mx-auto max-w-6xl p-6",
      )}
    >
      <div className={cn("shrink-0", step === 2 ? "border-b border-border px-4 py-3 sm:px-6" : "")}>
        <Link
          href="/simulator"
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <CaretLeft size={16} />
          {t("simulator.wizard.backToList")}
        </Link>

        {step !== 2 && <PageHeader title={t("simulator.list.new")} className="mb-6" />}

        {catalogSkuCount > 0 && (
          <div className="mb-4 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground">
            {catalogSkuCount > 1
              ? t("simulator.wizard.catalogSeedOther", { count: catalogSkuCount })
              : t("simulator.wizard.catalogSeedOne", { count: catalogSkuCount })}
          </div>
        )}

        {seedError && (
          <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {seedError}
          </div>
        )}

        <ol className={cn("flex items-center gap-2", step === 2 ? "mb-0" : "mb-8")}>
        {STEPS.map((s, i) => {
          const active = step === s.id;
          const done = step > s.id;
          return (
            <li key={s.id} className="flex flex-1 items-center gap-2 last:flex-none">
              <button
                type="button"
                onClick={() => (s.id < step || step1Ok ? setStep(s.id) : undefined)}
                disabled={s.id > step && !step1Ok}
                className="flex items-center gap-2 disabled:cursor-not-allowed"
              >
                <span
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm font-bold transition-colors",
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : done
                        ? "border-primary bg-accent text-accent-foreground"
                        : "border-border text-muted-foreground"
                  )}
                >
                  {s.id}
                </span>
                <span
                  className={cn(
                    "hidden text-sm font-medium sm:inline",
                    active ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  {t(s.label)}
                </span>
              </button>
              {i < STEPS.length - 1 && (
                <span
                  className={cn(
                    "h-0.5 flex-1 rounded-full",
                    step > s.id ? "bg-primary" : "bg-border"
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
      </div>

      {error && (
        <div
          className={cn(
            "rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive",
            step === 2 ? "mx-4 mt-3 shrink-0 sm:mx-6" : "mb-4",
          )}
        >
          {error}
        </div>
      )}
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col",
          step === 2 ? "overflow-hidden px-4 py-3 sm:px-6" : "mb-8",
        )}
      >
        {step === 1 && (
          <div className="flex min-h-[calc(100dvh-18rem)] flex-col">
            <TypeStep
              label={draft.label}
              type={draft.type}
              clientIds={draft.clientIds}
              projectName={draft.projectName}
              onLabel={(v) => update({ label: v })}
              onType={(v) => update({ type: v })}
              onClientIds={(v) => update({ clientIds: v })}
              onProjectName={(v) => update({ projectName: v })}
            />
          </div>
        )}
        {step === 2 && (
          <SkuStep
            className="min-h-0 flex-1"
            selectedSkus={draft.selectedSkus}
            notFoundSkus={draft.notFoundSkus}
            simulationType={draft.type}
            onChange={(v) => update({ selectedSkus: v })}
            onNotFoundChange={(v) => update({ notFoundSkus: v })}
          />
        )}
        {step === 3 && (
          <ParamsStep
            marketParams={draft.marketParams}
            purchaseChain={draft.purchaseChain}
            saleChain={draft.saleChain}
            mixPct={draft.mixPct}
            symeaPct={draft.symeaPct}
            syskernPct={draft.syskernPct}
            symeaPosition={draft.symeaPosition}
            saleIncoterm={draft.saleIncoterm}
            saleIncotermLocation={draft.saleIncotermLocation}
            onMarketParams={(v) => update({ marketParams: v })}
            onPurchaseChain={(v) => update({ purchaseChain: v })}
            onSaleChain={(v) => update({ saleChain: v })}
            onMixPct={(v) => update({ mixPct: v })}
            onSymeaPct={(v) => update({ symeaPct: v })}
            onSyskernPct={(v) => update({ syskernPct: v })}
            onSymeaPosition={(v) => update({ symeaPosition: v })}
            onSaleIncoterm={(v) => update({ saleIncoterm: v })}
            onSaleIncotermLocation={(v) => update({ saleIncotermLocation: v })}
            issues={step3Issues}
          />
        )}
      </div>

      <div
        className={cn(
          "flex shrink-0 items-center justify-between border-t border-border pt-4",
          step === 2 ? "px-4 pb-4 sm:px-6" : "",
        )}
      >
        <Button
          type="button"
          variant="outline"
          onClick={() => (step > 1 ? setStep((s) => s - 1) : router.push("/simulator"))}
        >
          {step > 1 ? t("simulator.wizard.previous") : t("common.cancel")}
        </Button>

        <Button
          type="button"
          onClick={goNext}
          disabled={(step === 1 && !step1Ok) || saving}
          className="gap-2"
        >
          {saving && <CircleNotch size={15} className="animate-spin" />}
          {step < 3 ? (
            <>
              {t("simulator.wizard.next")}
              <CaretRight size={16} />
            </>
          ) : saving ? (
            t("simulator.wizard.creating")
          ) : (
            t("simulator.wizard.create")
          )}
        </Button>
      </div>

      <WizardCreateWarningsDialog
        open={createWarnings !== null}
        warnings={createWarnings ?? []}
        saving={saving}
        onCancel={() => setCreateWarnings(null)}
        onConfirm={() => {
          setCreateWarnings(null);
          setError(null);
          void handleSubmit();
        }}
      />
    </div>
  );
}
