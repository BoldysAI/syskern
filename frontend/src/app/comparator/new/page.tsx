"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CaretLeft, CaretRight, CircleNotch } from "@phosphor-icons/react";
import { createSavedComparison, getSimulations, type Simulation } from "@/lib/api";
import useSWR from "swr";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { CompareWorkspace } from "@/app/comparator/_components/CompareWorkspace";
import { SelectedColumnsOrder } from "@/app/comparator/_components/SelectedColumnsOrder";
import { NameStep } from "./_components/NameStep";
import { SimulationsStep } from "./_components/SimulationsStep";
import {
  clearDraft,
  draftFromSearchParams,
  loadDraft,
  persistDraft,
  step1Valid,
  step2Valid,
  type ComparisonWizardDraft,
} from "./_components/wizard-draft";

const STEPS = [
  { id: 1, label: "Nom" },
  { id: 2, label: "Simulations" },
  { id: 3, label: "Aperçu" },
] as const;

function NewComparisonWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefill = useMemo(
    () =>
      draftFromSearchParams({
        sims: searchParams.get("sims"),
        recalc: searchParams.get("recalc"),
      }),
    [searchParams],
  );

  const [draft, setDraft] = useState<ComparisonWizardDraft>(() => loadDraft(prefill));
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    persistDraft(draft);
  }, [draft]);

  const update = (patch: Partial<ComparisonWizardDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const step1Ok = step1Valid(draft);
  const step2Ok = step2Valid(draft);

  const { data: simulations } = useSWR<Simulation[]>(
    step >= 2 ? "simulations" : null,
    () => getSimulations(),
  );

  const handleCreate = async () => {
    if (!step1Ok || !step2Ok || saving) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await createSavedComparison({
        label: draft.label.trim(),
        note: draft.note.trim() || undefined,
        simulation_ids: draft.simulationIds,
        recalculation_ids: draft.recalculationIds,
      });
      clearDraft();
      router.push(`/comparator/${saved.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Création de la comparaison échouée.");
      setSaving(false);
    }
  };

  const goNext = () => {
    setError(null);
    if (step === 1 && !step1Ok) return;
    if (step === 2 && !step2Ok) return;
    if (step < 3) setStep((s) => s + 1);
    else void handleCreate();
  };

  const goBack = () => {
    setError(null);
    if (step > 1) setStep((s) => s - 1);
  };

  return (
    <div
      className={cn(
        "flex flex-col",
        step === 2 ? "h-[calc(100dvh-3.5rem)] overflow-hidden" : "mx-auto max-w-6xl p-6",
      )}
    >
      <div className={cn("shrink-0", step === 2 ? "border-b border-border px-4 py-3 sm:px-6" : "")}>
        <Link
          href="/comparator"
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <CaretLeft size={16} />
          Retour aux comparaisons
        </Link>

        {step !== 2 && <PageHeader title="Nouvelle comparaison" className="mb-6" />}

        <ol className={cn("flex items-center gap-2", step === 2 ? "mb-0" : "mb-8")}>
          {STEPS.map((s, i) => {
            const active = step === s.id;
            const done = step > s.id;
            return (
              <li key={s.id} className="flex flex-1 items-center gap-2 last:flex-none">
                <button
                  type="button"
                  onClick={() => {
                    if (s.id < step) setStep(s.id);
                    else if (s.id === 2 && step1Ok) setStep(2);
                    else if (s.id === 3 && step1Ok && step2Ok) setStep(3);
                  }}
                  disabled={(s.id === 2 && !step1Ok) || (s.id === 3 && (!step1Ok || !step2Ok))}
                  className="flex items-center gap-2 disabled:cursor-not-allowed"
                >
                  <span
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm font-bold transition-colors",
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : done
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground",
                    )}
                  >
                    {s.id}
                  </span>
                  <span
                    className={cn(
                      "hidden text-sm font-medium sm:inline",
                      active ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {s.label}
                  </span>
                </button>
                {i < STEPS.length - 1 && <span className="hidden h-px flex-1 bg-border sm:block" />}
              </li>
            );
          })}
        </ol>
      </div>

      <div className={cn("min-h-0 flex-1", step === 2 ? "overflow-hidden p-4 sm:p-6" : "")}>
        {step === 1 && <NameStep draft={draft} onChange={update} />}
        {step === 2 && <SimulationsStep draft={draft} onChange={update} />}
        {step === 3 && (
          <div className="space-y-6">
            <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm">
              <p className="font-semibold text-foreground">{draft.label}</p>
              {draft.note && <p className="mt-1 text-muted-foreground">{draft.note}</p>}
            </div>
            <SelectedColumnsOrder
              simulationIds={draft.simulationIds}
              recalculationIds={draft.recalculationIds}
              simulations={simulations ?? []}
              readOnly
            />
            <CompareWorkspace
              simulationIds={draft.simulationIds}
              recalculationIds={draft.recalculationIds}
              compareReturnHref={`/comparator/new?sims=${draft.simulationIds.join(",")}${draft.recalculationIds.length ? `&recalc=${draft.recalculationIds.join(",")}` : ""}`}
              compareReturnLabel="Nouvelle comparaison"
              onSimulationIdsChange={(ids) => update({ simulationIds: ids })}
            />
          </div>
        )}
      </div>

      {error && (
        <div className="mx-6 mb-2 rounded-lg bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div
        className={cn(
          "flex shrink-0 items-center justify-between gap-3 border-t border-border bg-card px-4 py-4 sm:px-6",
          step !== 2 && "mx-auto w-full max-w-6xl border-none bg-transparent px-6 pb-6",
        )}
      >
        <Button type="button" variant="outline" onClick={goBack} disabled={step === 1 || saving}>
          <CaretLeft size={16} />
          Précédent
        </Button>
        <Button
          type="button"
          onClick={goNext}
          disabled={
            saving ||
            (step === 1 && !step1Ok) ||
            (step === 2 && !step2Ok)
          }
          className="gap-2"
        >
          {saving && <CircleNotch size={16} className="animate-spin" />}
          {step < 3 ? (
            <>
              Suivant
              <CaretRight size={16} />
            </>
          ) : (
            "Créer la comparaison"
          )}
        </Button>
      </div>
    </div>
  );
}

export default function NewComparisonPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Chargement…</div>}>
      <NewComparisonWizard />
    </Suspense>
  );
}
