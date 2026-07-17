"use client";

import { useEffect, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { CircleNotch, Info } from "@phosphor-icons/react";
import { AppModal } from "@/components/AppModal";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ConfirmProvider";
import { SimulationParamsFields } from "@/app/simulator/_components/SimulationParamsFields";
import {
  buildSimulationPatch,
  simulationToEditDraft,
  validateTransportChains,
  type WizardDraft,
} from "@/app/simulator/new/_components/wizard-draft";
import {
  duplicateSimulation,
  getSimulation,
  listTransportModes,
  recalculateSimulation,
  updateSimulation,
  type SimulationDetail,
  type SimulationStatus,
  type TransportMode,
} from "@/lib/api";
import { humanizeApiError } from "@/lib/humanize-errors";
import { toast } from "sonner";

interface Props {
  simulationId: string | null;
  simulationLabel: string;
  simulationStatus: SimulationStatus | null;
  open: boolean;
  onClose: () => void;
  onSaved: (result: { sourceId: string; effectiveId: string }) => void;
  /** Appended to the label when forking a finalized simulation. */
  duplicateLabelSuffix?: string;
  /** Confirm dialog body when forking a finalized/archived simulation. */
  finalizedForkDescription?: string;
  /** Optional banner above the form (finalized/archived only). */
  finalizedBanner?: React.ReactNode;
}

/** Keep label / type / clients from the loaded sim; only pricing params come from the editor draft. */
function mergeParamsDraft(draft: WizardDraft, sim: SimulationDetail): WizardDraft {
  const base = simulationToEditDraft(sim);
  return {
    ...base,
    marketParams: draft.marketParams,
    saleIncoterm: draft.saleIncoterm,
    saleIncotermLocation: draft.saleIncotermLocation,
    mixPct: draft.mixPct,
    symeaPct: draft.symeaPct,
    syskernPct: draft.syskernPct,
    symeaPosition: draft.symeaPosition,
    purchaseChain: draft.purchaseChain,
    saleChain: draft.saleChain,
  };
}

export function SimulationParamsSheet({
  simulationId,
  simulationLabel,
  simulationStatus,
  open,
  onClose,
  onSaved,
  duplicateLabelSuffix = "(copie)",
  finalizedForkDescription,
  finalizedBanner,
}: Props) {
  const confirm = useConfirm();
  const [draft, setDraft] = useState<WizardDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: sim, isLoading } = useSWR<SimulationDetail>(
    open && simulationId ? ["simulation", simulationId] : null,
    () => getSimulation(simulationId!),
  );

  const { data: transportModes } = useSWR<TransportMode[]>(
    open ? "transport-modes-active" : null,
    () => listTransportModes(true),
  );

  useEffect(() => {
    if (sim) setDraft(simulationToEditDraft(sim));
  }, [sim]);

  const isFinalized = simulationStatus === "finalized" || simulationStatus === "archived";

  const update = (patch: Partial<WizardDraft>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
  };

  const handleSaveAndRecalculate = async () => {
    if (!simulationId || !draft || !sim) return;
    setError(null);

    const transportErr = validateTransportChains(draft);
    if (transportErr) {
      setError(transportErr);
      return;
    }

    if (isFinalized) {
      const ok = await confirm({
        title: "Créer une copie brouillon",
        description:
          finalizedForkDescription ??
          `La simulation « ${simulationLabel} » est finalisée et ne peut pas être modifiée directement. Enregistrer créera une nouvelle simulation en mode brouillon avec les paramètres saisis. L'original reste inchangé.`,
        confirmLabel: "Créer et recalculer",
      });
      if (!ok) return;
    }

    setBusy(true);
    try {
      let targetId = simulationId;
      let contextSim: SimulationDetail = sim;

      if (isFinalized) {
        const suffix = duplicateLabelSuffix.startsWith(" ")
          ? duplicateLabelSuffix
          : ` ${duplicateLabelSuffix}`;
        const copyLabel = `${sim.label}${suffix}`;
        const copied = await duplicateSimulation(simulationId, copyLabel);
        targetId = copied.id;
        contextSim = copied;
      }

      const paramsOnly = mergeParamsDraft(draft, contextSim);

      await updateSimulation(targetId, buildSimulationPatch(paramsOnly));
      await recalculateSimulation(targetId, { scope: "params_only" });

      void globalMutate(["simulation", targetId]);
      void globalMutate("simulations");
      toast.success(
        isFinalized
          ? "Nouvelle simulation brouillon créée et recalculée."
          : "Paramètres enregistrés et simulation recalculée.",
      );
      onSaved({ sourceId: simulationId, effectiveId: targetId });
      onClose();
    } catch (e) {
      const msg = humanizeApiError(e, "Enregistrement échoué.");
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const supplierLines =
    sim?.lines.map((l) => ({
      incoterm: l.supplier_snapshot?.incoterm as string | undefined,
    })) ?? [];

  const defaultFinalizedBanner =
    simulationStatus === "archived" ? (
      <>
        Cette simulation est <strong>archivée</strong>. Toute modification créera une{" "}
        <strong>nouvelle simulation en brouillon</strong>. L&apos;original reste intact.
      </>
    ) : (
      <>
        Cette simulation est <strong>finalisée</strong>. Toute modification créera une{" "}
        <strong>nouvelle simulation en brouillon</strong> à partir de vos paramètres.
        L&apos;original reste intact.
      </>
    );

  return (
    <AppModal
      open={open}
      onOpenChange={(v) => !v && !busy && onClose()}
      title={`Paramètres — ${simulationLabel}`}
      size="full"
    >
      {isLoading || !draft ? (
        <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
          <CircleNotch size={20} className="mr-2 animate-spin" />
          Chargement…
        </div>
      ) : (
        <div className="flex min-h-0 flex-col gap-4">
          {isFinalized && (
            <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
              <Info size={18} className="mt-0.5 shrink-0" weight="duotone" />
              <p>{finalizedBanner ?? defaultFinalizedBanner}</p>
            </div>
          )}

          <SimulationParamsFields
            draft={draft}
            onChange={update}
            supplierLines={supplierLines}
            transportModes={transportModes ?? []}
            introText="Modifiez les paramètres de calcul de cette simulation. Les changements seront enregistrés et un recalcul sera lancé."
            nestedMarketModal
          />

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="sticky bottom-0 flex gap-3 border-t border-border bg-card pt-4">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose} disabled={busy}>
              Annuler
            </Button>
            <Button type="button" className="flex-1" onClick={() => void handleSaveAndRecalculate()} disabled={busy}>
              {busy ? (
                <>
                  <CircleNotch size={16} className="animate-spin" />
                  Enregistrement…
                </>
              ) : (
                "Enregistrer et recalculer"
              )}
            </Button>
          </div>
        </div>
      )}
    </AppModal>
  );
}
