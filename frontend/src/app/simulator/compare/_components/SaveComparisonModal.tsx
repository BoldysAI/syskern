"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Bookmark, Loader2, X } from "lucide-react";
import { createSavedComparison } from "@/lib/api";

interface Props {
  open: boolean;
  onClose: () => void;
  simulationIds: string[];
  recalculationIds: string[];
  defaultLabel?: string;
  onSaved: (id: string) => void;
}

export function SaveComparisonModal({
  open,
  onClose,
  simulationIds,
  recalculationIds,
  defaultLabel,
  onSaved,
}: Props) {
  const [label, setLabel] = useState(defaultLabel ?? "");
  const [note, setNote] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      const fallback =
        defaultLabel?.trim() ||
        `Comparaison du ${new Date().toLocaleDateString("fr-FR")}`;
      setLabel(fallback);
      setNote("");
      setError(null);
    }
  }, [open, defaultLabel]);

  const close = () => {
    if (running) return;
    onClose();
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) close();
  };

  const handleSave = async () => {
    setRunning(true);
    setError(null);
    try {
      const saved = await createSavedComparison({
        label: label.trim(),
        simulation_ids: simulationIds,
        recalculation_ids: recalculationIds,
        note: note.trim() || undefined,
      });
      onSaved(saved.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement échoué.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white shadow-xl focus:outline-none">
          <div className="flex items-center justify-between border-b border-border p-5">
            <Dialog.Title className="flex items-center gap-2 text-lg font-semibold text-slate-900">
              <Bookmark size={18} className="text-warm" />
              Enregistrer la comparaison
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
              {simulationIds.length} simulation{simulationIds.length !== 1 ? "s" : ""}
              {recalculationIds.length > 0 &&
                ` · ${recalculationIds.length} snapshot${recalculationIds.length !== 1 ? "s" : ""}`}
              {" — "}vous pourrez rouvrir cette comparaison depuis la liste enregistrée.
            </p>
            <div>
              <label htmlFor="save-compare-label" className="block text-xs font-semibold text-slate-600">
                Nom de la comparaison
              </label>
              <input
                id="save-compare-label"
                value={label}
                disabled={running}
                onChange={(e) => setLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && label.trim()) handleSave();
                }}
                placeholder="Ex. Tarif Q2 vs Q3"
                autoComplete="off"
                className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div>
              <label htmlFor="save-compare-note" className="block text-xs font-semibold text-slate-600">
                Note (optionnel)
              </label>
              <textarea
                id="save-compare-note"
                value={note}
                disabled={running}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                className="mt-2 w-full resize-none rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
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
              onClick={handleSave}
              disabled={running || !label.trim()}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
            >
              {running && <Loader2 size={14} className="animate-spin" />}
              Enregistrer
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
