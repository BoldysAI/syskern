"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Archive,
  ArrowCounterClockwise,
  CheckCircle,
  Copy,
  CircleNotch,
  SidebarSimple,
  PencilSimple,
  Trash,
  ArrowsOut,
} from "@phosphor-icons/react";
import {
  archiveSimulation,
  deleteSimulation,
  listTransportModes,
  unarchiveSimulation,
  updateSimulation,
  type SimulationDetail,
  type TransportMode,
} from "@/lib/api";
import useSWR from "swr";
import { FinalizeModal } from "./FinalizeModal";
import { DuplicateModal } from "./DuplicateModal";
import { cn } from "@/lib/utils";
import { humanizeApiError } from "@/lib/humanize-errors";
import { useAutosave } from "@/hooks/useAutosave";
import { useConfirm } from "@/components/ConfirmProvider";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { SimulationParamsFields } from "@/app/simulator/_components/SimulationParamsFields";
import { TypeStep } from "../../new/_components/TypeStep";
import {
  buildMarketParams,
  buildSimulationPatch,
  simulationToEditDraft,
  step1Valid,
  validateTransportChains,
  type WizardDraft,
} from "../../new/_components/wizard-draft";

interface Props {
  sim: SimulationDetail;
  readOnly: boolean;
  onChanged: () => void;
  onCollapse: () => void;
  onOpenParamsSheet?: () => void;
  onMarketParamsChange?: (params: Record<string, string>) => void;
}

export function SimulationSidebar({
  sim,
  readOnly,
  onChanged,
  onCollapse,
  onOpenParamsSheet,
  onMarketParamsChange,
}: Props) {
  const router = useRouter();
  const confirm = useConfirm();
  const [draft, setDraft] = useState<WizardDraft>(() => simulationToEditDraft(sim));
  const [contextOpen, setContextOpen] = useState(false);
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const { data: transportModes } = useSWR<TransportMode[]>("transport-modes-active", () =>
    listTransportModes(true)
  );

  const update = (patch: Partial<WizardDraft>) => setDraft((d) => ({ ...d, ...patch }));

  // Autosave (CDC §6.9.4 → debounce 1s). Validate before PATCH so we never
  // persist an invalid chain; the backend marks the simulation dirty.
  const persist = useCallback(
    async (d: WizardDraft) => {
      if (!step1Valid(d)) {
        throw new Error("Complétez le libellé et le contexte (projet : 1 client + nom).");
      }
      const transportErr = validateTransportChains(d);
      if (transportErr) throw new Error(transportErr);
      await updateSimulation(sim.id, buildSimulationPatch(d));
      onChanged();
    },
    [sim.id, onChanged]
  );

  const { status, error } = useAutosave(draft, persist, { delay: 1000, enabled: !readOnly });

  useEffect(() => {
    onMarketParamsChange?.(buildMarketParams(draft.marketParams));
  }, [draft.marketParams, onMarketParamsChange]);

  const saveMarketParamsNow = async (marketParams: WizardDraft["marketParams"]) => {
    const next = { ...draft, marketParams };
    setDraft(next);
    if (readOnly) return;
    await persist(next);
  };

  const supplierLines = sim.lines.map((l) => ({
    incoterm: l.supplier_snapshot?.incoterm as string | undefined,
  }));

  const runAction = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
      onChanged();
    } catch (e) {
      toast.error(humanizeApiError(e, "Action échouée"));
    } finally {
      setBusy(null);
    }
  };

  const saveLabel =
    status === "saving"
      ? "Enregistrement…"
      : status === "saved"
        ? "Enregistré"
        : status === "error"
          ? "Erreur de sauvegarde"
          : "";

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-border bg-card p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-base font-bold text-foreground">{sim.label}</h2>
              {!readOnly && (
                <button
                  onClick={() => setContextOpen(true)}
                  className="shrink-0 text-muted-foreground hover:text-warm"
                  aria-label="Modifier le contexte"
                >
                  <PencilSimple size={14} />
                </button>
              )}
            </div>
            <div className="mt-1 flex items-center gap-2">
              <StatusBadge
                variant={
                  sim.status === "finalized"
                    ? "success"
                    : sim.status === "archived"
                      ? "draft"
                      : "warning"
                }
              >
                {sim.status === "finalized"
                  ? "Finalisé"
                  : sim.status === "archived"
                    ? "Archivé"
                    : "Brouillon"}
              </StatusBadge>
              {!readOnly && saveLabel && (
                <span
                  className={cn(
                    "text-xs",
                    status === "error" ? "text-destructive" : "text-muted-foreground"
                  )}
                >
                  {saveLabel}
                </span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-stretch overflow-hidden rounded-lg border border-border">
            {onOpenParamsSheet && sim.status !== "archived" && (
              <button
                type="button"
                onClick={onOpenParamsSheet}
                className="border-r border-border p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Ouvrir les paramètres en plein écran"
                title="Plein écran"
              >
                <ArrowsOut size={18} />
              </button>
            )}
            <button
              type="button"
              onClick={onCollapse}
              className="p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Réduire le panneau"
              title="Réduire le panneau"
            >
              <SidebarSimple size={18} />
            </button>
          </div>
        </div>

        {!readOnly && error && (
          <p className="mt-2 rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">{error}</p>
        )}

        {/* Header actions */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {!readOnly && (
            <button
              onClick={() => setFinalizeOpen(true)}
              disabled={busy !== null || sim.is_dirty || sim.line_count === 0}
              title={sim.is_dirty ? "Recalculez avant de finaliser" : undefined}
              className="flex items-center gap-1.5 rounded-lg border border-green-300 px-2.5 py-1.5 text-xs font-medium text-green-700 transition-colors hover:bg-green-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CheckCircle size={13} />
              Finaliser
            </button>
          )}
          {sim.status === "finalized" && (
            <button
              onClick={() => runAction("archive", () => archiveSimulation(sim.id))}
              disabled={busy !== null}
              className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              <Archive size={13} />
              Archiver
            </button>
          )}
          {sim.status === "archived" && (
            <button
              onClick={() => runAction("unarchive", () => unarchiveSimulation(sim.id))}
              disabled={busy !== null}
              className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              <ArrowCounterClockwise size={13} />
              Désarchiver
            </button>
          )}
          <button
            onClick={() => setDuplicateOpen(true)}
            disabled={busy !== null}
            className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            <Copy size={13} />
            Dupliquer
          </button>
          {!readOnly && (
            <button
              onClick={async () => {
                const ok = await confirm({
                  title: "Supprimer la simulation",
                  description: `Supprimer la simulation « ${sim.label} » ?`,
                  confirmLabel: "Supprimer",
                  destructive: true,
                });
                if (!ok) return;
                runAction("delete", async () => {
                  await deleteSimulation(sim.id);
                  router.push("/simulator");
                });
              }}
              disabled={busy !== null}
              className="flex items-center gap-1.5 rounded-lg border border-destructive/30 px-2.5 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
            >
              <Trash size={13} />
              Supprimer
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-4 p-4">
        <SimulationParamsFields
          draft={draft}
          onChange={update}
          readOnly={readOnly}
          supplierLines={supplierLines}
          transportModes={transportModes ?? []}
          onMarketParamsSave={readOnly ? undefined : saveMarketParamsNow}
        />
      </div>

      <FinalizeModal
        simId={sim.id}
        simLabel={sim.label}
        open={finalizeOpen}
        onClose={() => setFinalizeOpen(false)}
        onDone={onChanged}
      />

      <DuplicateModal
        key={duplicateOpen ? "dup-open" : "dup-closed"}
        simId={sim.id}
        simLabel={sim.label}
        open={duplicateOpen}
        onClose={() => setDuplicateOpen(false)}
        onDuplicated={(newId) => router.push(`/simulator/${newId}`)}
      />

      {/* Context modal (type / clients / project name) */}
      <Dialog open={contextOpen} onOpenChange={setContextOpen}>
        <DialogContent className="max-w-lg gap-0 p-0">
          <DialogHeader className="border-b border-border p-5">
            <DialogTitle>Contexte de la simulation</DialogTitle>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-y-auto p-5">
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
          <DialogFooter>
            <Button type="button" onClick={() => setContextOpen(false)}>
              Fermer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {busy && (
        <div className="pointer-events-none fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg bg-foreground/90 px-3 py-2 text-sm text-background">
          <CircleNotch size={14} className="animate-spin" />
          Traitement…
        </div>
      )}
    </div>
  );
}
