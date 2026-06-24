"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Copy, Loader2, X } from "lucide-react";
import { duplicateSimulation } from "@/lib/api";

interface Props {
  simId: string;
  simLabel: string;
  open: boolean;
  onClose: () => void;
  onDuplicated: (newId: string) => void;
}

export function DuplicateModal({ simId, simLabel, open, onClose, onDuplicated }: Props) {
  const [label, setLabel] = useState(`${simLabel} (copie)`);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (running) return;
    onClose();
  };

  const handleDuplicate = async () => {
    setRunning(true);
    setError(null);
    try {
      const dup = await duplicateSimulation(simId, label.trim() || undefined);
      onDuplicated(dup.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Duplication échouée.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white shadow-xl focus:outline-none">
          <div className="flex items-center justify-between border-b border-border p-5">
            <Dialog.Title className="flex items-center gap-2 text-lg font-semibold text-slate-900">
              <Copy size={18} className="text-warm" />
              Dupliquer la simulation
            </Dialog.Title>
            <Dialog.Close
              disabled={running}
              className="text-slate-400 hover:text-slate-600 disabled:opacity-40"
              aria-label="Fermer"
            >
              <X size={20} />
            </Dialog.Close>
          </div>

          <div className="flex flex-col gap-3 p-5">
            <p className="text-sm text-slate-500">
              Une copie en brouillon sera créée avec ses lignes (surcharges et derniers résultats
              figés). Les offres associées ne sont pas copiées.
            </p>
            <div>
              <label htmlFor="duplicate-label" className="block text-xs font-semibold text-slate-600">
                Libellé de la copie
              </label>
              <input
                id="duplicate-label"
                value={label}
                disabled={running}
                onChange={(e) => setLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && label.trim()) handleDuplicate();
                }}
                autoComplete="off"
                className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            {error && (
              <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
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
              onClick={handleDuplicate}
              disabled={running || !label.trim()}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
            >
              {running && <Loader2 size={14} className="animate-spin" />}
              Dupliquer
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
