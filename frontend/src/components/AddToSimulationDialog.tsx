"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, Loader2, X } from "lucide-react";
import {
  addSimulationLines,
  createSimulation,
  getSimulations,
  type Simulation,
  type SimulationType,
} from "@/lib/api";
import { cn } from "@/lib/utils";

interface AddToSimulationDialogProps {
  productIds: string[];
  productLabel: string;
  /** Called after products are successfully added. */
  onAdded?: () => void;
  /** The element that opens the dialog (wrapped as the trigger). */
  children: ReactNode;
}

type Tab = "existing" | "new";

const inputCls =
  "w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary";

export function AddToSimulationDialog({
  productIds,
  productLabel,
  onAdded,
  children,
}: AddToSimulationDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("existing");
  const [selectedSim, setSelectedSim] = useState<string>("");
  const [newLabel, setNewLabel] = useState("");
  const [newType, setNewType] = useState<SimulationType>("tariff");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only fetch when the dialog is open; only drafts can receive new lines.
  const { data: simulations, isLoading } = useSWR<Simulation[]>(
    open ? "simulations-for-add" : null,
    getSimulations,
  );
  const drafts = (simulations ?? []).filter((s) => s.status === "draft");

  const resetState = () => {
    setTab("existing");
    setSelectedSim("");
    setNewLabel("");
    setNewType("tariff");
    setSubmitting(false);
    setError(null);
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) resetState();
  };

  const handleConfirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      let simId = selectedSim;
      if (tab === "new") {
        const sim = await createSimulation({
          label: newLabel.trim(),
          simulation_type: newType,
        });
        simId = sim.id;
      }
      await addSimulationLines(simId, productIds);
      onAdded?.();
      setOpen(false);
      router.push(`/simulator/${simId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de l'ajout à la simulation.");
    } finally {
      setSubmitting(false);
    }
  };

  const canConfirm =
    !submitting && (tab === "existing" ? selectedSim !== "" : newLabel.trim().length > 0);

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Trigger asChild>{children}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-popover shadow-xl focus:outline-none">
          <div className="flex items-center justify-between p-5 border-b border-border">
            <Dialog.Title className="text-lg font-semibold text-foreground">
              Ajouter à une simulation
            </Dialog.Title>
            <Dialog.Close className="text-muted-foreground hover:text-muted-foreground" aria-label="Fermer">
              <X size={20} />
            </Dialog.Close>
          </div>

          <div className="p-5">
            <Dialog.Description className="text-sm text-muted-foreground mb-4">
              {productIds.length > 1 ? "Produits" : "Produit"}{" "}
              <span className="font-mono font-medium text-foreground">{productLabel}</span>
            </Dialog.Description>

            <div className="flex gap-2 mb-4">
                  {(["existing", "new"] as Tab[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTab(t)}
                      className={cn(
                        "flex-1 py-2 text-sm font-medium rounded-lg border transition-colors",
                        tab === t
                          ? "border-primary bg-accent text-accent-foreground"
                          : "border-border text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {t === "existing" ? "Simulation existante" : "Nouvelle simulation"}
                    </button>
                  ))}
                </div>

                {tab === "existing" ? (
                  isLoading ? (
                    <div className="py-6 text-center text-sm text-muted-foreground">Chargement…</div>
                  ) : drafts.length === 0 ? (
                    <div className="py-6 text-center text-sm text-muted-foreground">
                      Aucune simulation brouillon. Créez-en une nouvelle.
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto">
                      {drafts.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => setSelectedSim(s.id)}
                          className={cn(
                            "flex items-center justify-between gap-2 px-3 py-2.5 text-left rounded-lg border transition-colors",
                            selectedSim === s.id
                              ? "border-primary bg-accent"
                              : "border-border hover:bg-muted",
                          )}
                        >
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-foreground truncate">
                              {s.label}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {s.simulation_type === "tariff" ? "Tarif" : "Projet"} · {s.line_count}{" "}
                              ligne(s)
                            </div>
                          </div>
                          {selectedSim === s.id && (
                            <Check size={16} className="text-primary shrink-0" />
                          )}
                        </button>
                      ))}
                    </div>
                  )
                ) : (
                  <div className="flex flex-col gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground mb-1.5">
                        Libellé *
                      </label>
                      <input
                        value={newLabel}
                        onChange={(e) => setNewLabel(e.target.value)}
                        placeholder="ex. Tarif Q2 2026"
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground mb-1.5">
                        Type
                      </label>
                      <div className="flex gap-2">
                        {(["tariff", "project"] as SimulationType[]).map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => setNewType(t)}
                            className={cn(
                              "flex-1 py-2 text-sm font-medium rounded-lg border transition-colors",
                              newType === t
                                ? "border-primary bg-accent text-accent-foreground"
                                : "border-border text-muted-foreground hover:bg-muted",
                            )}
                          >
                            {t === "tariff" ? "Tarif" : "Projet"}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {error && (
                  <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                    {error}
                  </div>
                )}

                <div className="flex gap-3 mt-5">
                  <Dialog.Close className="flex-1 text-center py-2.5 text-sm border border-border rounded-lg hover:bg-muted transition-colors text-muted-foreground">
                    Annuler
                  </Dialog.Close>
                  <button
                    type="button"
                    onClick={handleConfirm}
                    disabled={!canConfirm}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm bg-primary hover:bg-primary/90 text-white rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submitting && <Loader2 size={15} className="animate-spin" />}
                    {submitting ? "Ajout…" : "Ajouter"}
                  </button>
                </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
