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
import { StockPurchaseMixSlider } from "@/app/simulator/_components/StockPurchaseMixSlider";
import {
  SaleIncotermFields,
  useIncotermPrefillConfirm,
} from "@/app/simulator/_components/SaleIncotermSection";
import {
  chainDraftHasContent,
  dominantPurchaseIncoterm,
  suggestPurchaseChainDraft,
  suggestSaleChainDraft,
} from "@/lib/incoterms";
import { ChainBuilder } from "../../new/_components/ChainBuilder";
import { MarketParamsModal } from "../../new/_components/MarketParamsModal";
import { TypeStep } from "../../new/_components/TypeStep";
import {
  buildMarketParams,
  buildSimulationPatch,
  simulationToEditDraft,
  step1Valid,
  validateTransportChains,
  type SymeaPosition,
  type WizardDraft,
} from "../../new/_components/wizard-draft";

const labelCls = "block text-xs font-semibold text-muted-foreground mb-1.5";
const inputCls =
  "w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary";

interface Props {
  sim: SimulationDetail;
  readOnly: boolean;
  onChanged: () => void;
  onCollapse: () => void;
  onMarketParamsChange?: (params: Record<string, string>) => void;
}

function MarketValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground font-data">{value || "—"}</span>
    </div>
  );
}

export function SimulationSidebar({
  sim,
  readOnly,
  onChanged,
  onCollapse,
  onMarketParamsChange,
}: Props) {
  const router = useRouter();
  const confirm = useConfirm();
  const [draft, setDraft] = useState<WizardDraft>(() => simulationToEditDraft(sim));
  const [marketOpen, setMarketOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const { data: transportModes } = useSWR<TransportMode[]>("transport-modes-active", () =>
    listTransportModes(true)
  );
  const { request: requestPrefill, modal: prefillModal } = useIncotermPrefillConfirm();

  const update = (patch: Partial<WizardDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const applySaleIncoterm = (code: string) => {
    requestPrefill(
      chainDraftHasContent(draft.saleChain),
      `Chaîne PV pour ${code}`,
      `Proposer une structure de chaîne PV adaptée à l'incoterm ${code} ? Les montants restent à saisir manuellement.`,
      () => update({ saleIncoterm: code, saleChain: suggestSaleChainDraft(code) })
    );
  };

  const applyPurchaseFromSuppliers = () => {
    const dominant = dominantPurchaseIncoterm(
      sim.lines.map((l) => ({
        incoterm: l.supplier_snapshot?.incoterm as string | undefined,
      }))
    );
    requestPrefill(
      chainDraftHasContent(draft.purchaseChain),
      `Chaîne PA pour ${dominant}`,
      `Proposer une structure PA adaptée à l'incoterm achat majoritaire (${dominant}) ? Les montants restent à saisir.`,
      () => update({ purchaseChain: suggestPurchaseChainDraft(dominant) })
    );
  };

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
          <button
            onClick={onCollapse}
            className="shrink-0 rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Réduire le panneau"
          >
            <SidebarSimple size={18} />
          </button>
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
        {/* Market params */}
        <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-bold text-foreground">Marché</h3>
            {!readOnly && (
              <button
                onClick={() => setMarketOpen(true)}
                className="flex items-center gap-1.5 text-xs font-semibold text-accent-foreground hover:text-warm"
              >
                <PencilSimple size={13} />
                Modifier
              </button>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <MarketValue
              label={`Cuivre base (${draft.marketParams.copper_currency ?? "RMB"})`}
              value={draft.marketParams.copper_base_price}
            />
            <MarketValue
              label={`Cuivre actuel (${draft.marketParams.copper_currency ?? "RMB"})`}
              value={draft.marketParams.copper_current_price}
            />
            <MarketValue label="FX EUR→RMB" value={draft.marketParams.fx_eur_rmb} />
            <MarketValue label="FX EUR→USD" value={draft.marketParams.fx_eur_usd} />
          </div>
        </section>

        {/* Sale incoterm (CDC §6.8.3) */}
        <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-bold text-foreground">Incoterm de vente</h3>
          <SaleIncotermFields
            incoterm={draft.saleIncoterm}
            location={draft.saleIncotermLocation}
            disabled={readOnly}
            onIncotermChange={applySaleIncoterm}
            onLocationChange={(saleIncotermLocation) => update({ saleIncotermLocation })}
          />
        </section>

        {/* Global params */}
        <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-bold text-foreground">Paramètres globaux</h3>
          <div className="flex flex-col gap-4">
            <StockPurchaseMixSlider
              value={draft.mixPct}
              disabled={readOnly}
              onChange={(mixPct) => update({ mixPct })}
            />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Marge Symea (%)</label>
                <input
                  type="number"
                  min={0}
                  max={99}
                  step="0.1"
                  value={draft.symeaPct}
                  disabled={readOnly}
                  onChange={(e) => update({ symeaPct: e.target.value })}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Marge Syskern (%)</label>
                <input
                  type="number"
                  min={0}
                  max={99}
                  step="0.1"
                  value={draft.syskernPct}
                  disabled={readOnly}
                  onChange={(e) => update({ syskernPct: e.target.value })}
                  className={inputCls}
                />
              </div>
            </div>
            <div>
              <label className={labelCls}>Position marge Symea</label>
              <div className="flex gap-2">
                {(["after_transports", "before_transports"] as SymeaPosition[]).map((pos) => (
                  <button
                    type="button"
                    key={pos}
                    disabled={readOnly}
                    onClick={() => update({ symeaPosition: pos })}
                    className={cn(
                      "flex-1 rounded-lg border py-2 text-xs font-medium transition-colors disabled:opacity-50",
                      draft.symeaPosition === pos
                        ? "border-primary bg-accent text-accent-foreground"
                        : "border-border text-muted-foreground hover:bg-muted"
                    )}
                  >
                    {pos === "after_transports" ? "Après transports" : "Avant transports"}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Chains */}
        {!readOnly && (
          <button
            type="button"
            onClick={applyPurchaseFromSuppliers}
            className="self-start text-xs font-medium text-warm hover:text-accent-foreground underline-offset-2 hover:underline"
          >
            Adapter la chaîne PA depuis les fournisseurs
          </button>
        )}
        <ChainBuilder
          title="Chaîne PA (achat)"
          chain={draft.purchaseChain}
          isPurchase
          transportModes={transportModes ?? []}
          onChange={(v) => update({ purchaseChain: v })}
        />
        <ChainBuilder
          title="Chaîne PV (vente)"
          chain={draft.saleChain}
          isPurchase={false}
          transportModes={transportModes ?? []}
          onChange={(v) => update({ saleChain: v })}
        />
      </div>

      <MarketParamsModal
        open={marketOpen}
        onOpenChange={setMarketOpen}
        value={draft.marketParams}
        onSave={(v) => void saveMarketParamsNow(v)}
      />

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

      {prefillModal}

      {busy && (
        <div className="pointer-events-none fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg bg-foreground/90 px-3 py-2 text-sm text-background">
          <CircleNotch size={14} className="animate-spin" />
          Traitement…
        </div>
      )}
    </div>
  );
}
