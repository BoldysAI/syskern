"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CaretLeft, CaretRight, CircleNotch } from "@phosphor-icons/react";
import { addSimulationLines, createSimulation } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { ParamsStep } from "./_components/ParamsStep";
import { SkuStep } from "./_components/SkuStep";
import { TypeStep } from "./_components/TypeStep";
import {
  buildSimulationPatch,
  clearDraft,
  loadDraft,
  persistDraft,
  step1Valid,
  validateTransportChains,
  type WizardDraft,
} from "./_components/wizard-draft";

const STEPS = [
  { id: 1, label: "Type et contexte" },
  { id: 2, label: "Sélection des SKU" },
  { id: 3, label: "Paramètres et chaîne" },
] as const;

export default function NewSimulationPage() {
  const router = useRouter();
  const [draft, setDraft] = useState<WizardDraft>(loadDraft);
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    persistDraft(draft);
  }, [draft]);

  const update = (patch: Partial<WizardDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const step1Ok = step1Valid(draft);
  const transportError = step === 3 ? validateTransportChains(draft) : null;
  const step3Valid = transportError === null;

  const canSubmit = step1Ok && step3Valid && !saving;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      const sim = await createSimulation(buildSimulationPatch(draft));
      if (draft.selectedSkus.length > 0) {
        await addSimulationLines(
          sim.id,
          draft.selectedSkus.map((s) => s.id)
        );
      }
      clearDraft();
      router.push(`/simulator/${sim.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Création de la simulation échouée.");
      setSaving(false);
    }
  };

  const goNext = () => {
    if (step === 1 && !step1Ok) return;
    if (step === 3) {
      const err = validateTransportChains(draft);
      if (err) {
        setError(err);
        return;
      }
    }
    setError(null);
    if (step < 3) setStep((s) => s + 1);
    else void handleSubmit();
  };

  return (
    <div className="mx-auto max-w-6xl p-6">
      <Link
        href="/simulator"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <CaretLeft size={16} />
        Retour aux simulations
      </Link>

      <PageHeader title="Nouvelle simulation" className="mb-6" />

      <ol className="mb-8 flex items-center gap-2">
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
                  {s.label}
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

      {error && (
        <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      {step === 3 && transportError && !error && (
        <div className="mb-4 rounded-lg border border-warm/30 bg-warm/10 p-3 text-sm text-foreground">
          {transportError}
        </div>
      )}

      <div className={cn("mb-8", step === 1 && "flex min-h-[calc(100dvh-18rem)] flex-col")}>
        {step === 1 && (
          <div className="flex min-h-0 flex-1 flex-col">
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
            selectedSkus={draft.selectedSkus}
            onChange={(v) => update({ selectedSkus: v })}
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
          />
        )}
      </div>

      <div className="flex items-center justify-between border-t border-border pt-5">
        <Button
          type="button"
          variant="outline"
          onClick={() => (step > 1 ? setStep((s) => s - 1) : router.push("/simulator"))}
        >
          {step > 1 ? "Précédent" : "Annuler"}
        </Button>

        <Button
          type="button"
          onClick={goNext}
          disabled={(step === 1 && !step1Ok) || (step === 3 && !step3Valid) || saving}
          className="gap-2"
        >
          {saving && <CircleNotch size={15} className="animate-spin" />}
          {step < 3 ? (
            <>
              Suivant
              <CaretRight size={16} />
            </>
          ) : saving ? (
            "Création…"
          ) : (
            "Créer la simulation"
          )}
        </Button>
      </div>
    </div>
  );
}
