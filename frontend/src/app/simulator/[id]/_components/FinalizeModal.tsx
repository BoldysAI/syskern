"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, CheckCircle2, Loader2, Lock, X } from "lucide-react";
import { finalizeSimulation } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Props {
  simId: string;
  simLabel: string;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}

const CONSEQUENCES = [
  "La simulation passe en lecture seule : plus aucune modification possible.",
  "Le recalcul est désactivé.",
  "Elle reste consultable et peut servir de base aux offres commerciales.",
  "Action irréversible (vous pourrez seulement l'archiver).",
];

/** Parse the JSON body carried by an apiFetch error ("API 400: {json}"). */
function parseFinalizeError(e: unknown): { detail: string; errors: string[] } {
  const fallback = { detail: "Finalisation échouée.", errors: [] as string[] };
  if (!(e instanceof Error)) return fallback;
  const idx = e.message.indexOf("{");
  if (idx === -1) return { detail: e.message, errors: [] };
  try {
    const body = JSON.parse(e.message.slice(idx)) as { detail?: string; errors?: string[] };
    return {
      detail: body.detail ?? fallback.detail,
      errors: Array.isArray(body.errors) ? body.errors.map(String) : [],
    };
  } catch {
    return { detail: e.message, errors: [] };
  }
}

export function FinalizeModal({ simId, simLabel, open, onClose, onDone }: Props) {
  const [confirmText, setConfirmText] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<{ detail: string; errors: string[] } | null>(null);

  const canConfirm = confirmText.trim() === simLabel.trim() && !running;

  const close = () => {
    if (running) return;
    setConfirmText("");
    setError(null);
    onClose();
  };

  const handleFinalize = async () => {
    if (!canConfirm) return;
    setRunning(true);
    setError(null);
    try {
      await finalizeSimulation(simId);
      onDone();
      setConfirmText("");
      onClose();
    } catch (e) {
      setError(parseFinalizeError(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white shadow-xl focus:outline-none">
          <div className="flex items-center justify-between border-b border-border p-5">
            <Dialog.Title className="flex items-center gap-2 text-lg font-semibold text-slate-900">
              <Lock size={18} className="text-green-600" />
              Finaliser la simulation
            </Dialog.Title>
            <Dialog.Close
              disabled={running}
              className="text-slate-400 hover:text-slate-600 disabled:opacity-40"
              aria-label="Fermer"
            >
              <X size={20} />
            </Dialog.Close>
          </div>

          <div className="flex flex-col gap-4 p-5">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-800">
                <AlertTriangle size={15} />
                Conséquences de la finalisation
              </p>
              <ul className="mt-2 flex flex-col gap-1.5">
                {CONSEQUENCES.map((c) => (
                  <li key={c} className="flex items-start gap-2 text-xs text-amber-900">
                    <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-amber-600" />
                    {c}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <label htmlFor="finalize-confirm" className="block text-xs font-semibold text-slate-600">
                Pour confirmer, saisissez le libellé de la simulation :
              </label>
              <p className="mt-1 select-none text-sm font-semibold text-slate-900">{simLabel}</p>
              <input
                id="finalize-confirm"
                value={confirmText}
                disabled={running}
                onChange={(e) => setConfirmText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canConfirm) handleFinalize();
                }}
                placeholder="Recopiez le libellé exact"
                autoComplete="off"
                className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                <p>{error.detail}</p>
                {error.errors.length > 0 && (
                  <ul className="mt-1.5 list-inside list-disc text-xs text-red-600">
                    {error.errors.map((sku) => (
                      <li key={sku}>{sku}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-border p-4">
            <button
              type="button"
              onClick={close}
              disabled={running}
              className="rounded-lg border border-border px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handleFinalize}
              disabled={!canConfirm}
              className={cn(
                "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors",
                canConfirm ? "bg-green-600 hover:bg-green-700" : "bg-slate-300"
              )}
            >
              {running && <Loader2 size={14} className="animate-spin" />}
              Finaliser
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
