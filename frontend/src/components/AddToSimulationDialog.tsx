"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import useSWR from "swr";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowRight, Check, Loader2, X } from "lucide-react";
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
  /** The element that opens the dialog (wrapped as the trigger). */
  children: ReactNode;
}

type Tab = "existing" | "new";

const inputCls =
  "w-full px-3 py-2 text-sm border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#E07200]/30 focus:border-[#E07200]";

export function AddToSimulationDialog({
  productIds,
  productLabel,
  children,
}: AddToSimulationDialogProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("existing");
  const [selectedSim, setSelectedSim] = useState<string>("");
  const [newLabel, setNewLabel] = useState("");
  const [newType, setNewType] = useState<SimulationType>("tariff");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneSimId, setDoneSimId] = useState<string | null>(null);

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
    setDoneSimId(null);
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
      setDoneSimId(simId);
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
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white shadow-xl focus:outline-none">
          <div className="flex items-center justify-between p-5 border-b border-[#E2E8F0]">
            <Dialog.Title className="text-lg font-semibold text-slate-900">
              Ajouter à une simulation
            </Dialog.Title>
            <Dialog.Close className="text-slate-400 hover:text-slate-600" aria-label="Fermer">
              <X size={20} />
            </Dialog.Close>
          </div>

          <div className="p-5">
            <Dialog.Description className="text-sm text-slate-500 mb-4">
              Produit <span className="font-mono font-medium text-slate-700">{productLabel}</span>
            </Dialog.Description>

            {doneSimId ? (
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                  <Check size={24} className="text-green-600" />
                </div>
                <p className="text-sm font-medium text-slate-800">
                  Produit ajouté à la simulation.
                </p>
                <Link
                  href={`/simulator/${doneSimId}`}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#E07200] hover:text-[#C56400]"
                >
                  Voir la simulation
                  <ArrowRight size={15} />
                </Link>
              </div>
            ) : (
              <>
                <div className="flex gap-2 mb-4">
                  {(["existing", "new"] as Tab[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTab(t)}
                      className={cn(
                        "flex-1 py-2 text-sm font-medium rounded-lg border transition-colors",
                        tab === t
                          ? "border-[#E07200] bg-[#FFF3E0] text-[#C56400]"
                          : "border-[#E2E8F0] text-slate-600 hover:bg-slate-50",
                      )}
                    >
                      {t === "existing" ? "Simulation existante" : "Nouvelle simulation"}
                    </button>
                  ))}
                </div>

                {tab === "existing" ? (
                  isLoading ? (
                    <div className="py-6 text-center text-sm text-slate-400">Chargement…</div>
                  ) : drafts.length === 0 ? (
                    <div className="py-6 text-center text-sm text-slate-400">
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
                              ? "border-[#E07200] bg-[#FFF3E0]"
                              : "border-[#E2E8F0] hover:bg-slate-50",
                          )}
                        >
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-slate-800 truncate">
                              {s.label}
                            </div>
                            <div className="text-xs text-slate-400">
                              {s.simulation_type === "tariff" ? "Tarif" : "Projet"} · {s.line_count}{" "}
                              ligne(s)
                            </div>
                          </div>
                          {selectedSim === s.id && (
                            <Check size={16} className="text-[#E07200] flex-shrink-0" />
                          )}
                        </button>
                      ))}
                    </div>
                  )
                ) : (
                  <div className="flex flex-col gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1.5">
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
                      <label className="block text-xs font-semibold text-slate-600 mb-1.5">
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
                                ? "border-[#E07200] bg-[#FFF3E0] text-[#C56400]"
                                : "border-[#E2E8F0] text-slate-600 hover:bg-slate-50",
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
                  <Dialog.Close className="flex-1 text-center py-2.5 text-sm border border-[#E2E8F0] rounded-lg hover:bg-slate-50 transition-colors text-slate-600">
                    Annuler
                  </Dialog.Close>
                  <button
                    type="button"
                    onClick={handleConfirm}
                    disabled={!canConfirm}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm bg-[#E07200] hover:bg-[#C56400] text-white rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submitting && <Loader2 size={15} className="animate-spin" />}
                    {submitting ? "Ajout…" : "Ajouter"}
                  </button>
                </div>
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
