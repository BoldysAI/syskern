"use client";

import { useState } from "react";
import useSWR from "swr";
import { PencilSimple } from "@phosphor-icons/react";
import {
  getSimulations,
  updateSavedComparison,
  type SavedComparison,
  type Simulation,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SimulationsStep } from "@/app/comparator/new/_components/SimulationsStep";
import {
  MAX_COMPARE_COLUMNS,
  type ComparisonWizardDraft,
} from "@/app/comparator/new/_components/wizard-draft";

interface Props {
  comparison: SavedComparison;
  open: boolean;
  onClose: () => void;
  onSaved: (updated: SavedComparison) => void;
}

export function ComparisonEditDialog({ comparison, open, onClose, onSaved }: Props) {
  const [tab, setTab] = useState<"meta" | "sims">("meta");
  const [draft, setDraft] = useState<ComparisonWizardDraft>(() => ({
    label: comparison.label,
    note: comparison.note,
    simulationIds: comparison.simulation_ids,
    recalculationIds: comparison.recalculation_ids,
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useSWR<Simulation[]>(open ? "simulations" : null, () => getSimulations());

  const columnCount = draft.simulationIds.length + draft.recalculationIds.length;
  const canSave =
    draft.label.trim().length > 0 && columnCount >= 2 && columnCount <= MAX_COMPARE_COLUMNS;

  const handleSave = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateSavedComparison(comparison.id, {
        label: draft.label.trim(),
        note: draft.note.trim(),
        simulation_ids: draft.simulationIds,
        recalculation_ids: draft.recalculationIds,
      });
      onSaved(updated);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Mise à jour échouée.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !saving) onClose();
      }}
    >
      <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border p-5">
          <DialogTitle className="flex items-center gap-2">
            <PencilSimple size={18} />
            Modifier la comparaison
          </DialogTitle>
        </DialogHeader>

        <div className="flex border-b border-border">
          <button
            type="button"
            onClick={() => setTab("meta")}
            className={`flex-1 py-2.5 text-sm font-medium ${
              tab === "meta" ? "border-b-2 border-primary text-foreground" : "text-muted-foreground"
            }`}
          >
            Nom et note
          </button>
          <button
            type="button"
            onClick={() => setTab("sims")}
            className={`flex-1 py-2.5 text-sm font-medium ${
              tab === "sims" ? "border-b-2 border-primary text-foreground" : "text-muted-foreground"
            }`}
          >
            Simulations
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {tab === "meta" ? (
            <div className="mx-auto max-w-lg space-y-4">
              <div>
                <label htmlFor="edit-label" className="mb-1.5 block text-xs font-semibold text-muted-foreground">
                  Nom
                </label>
                <Input
                  id="edit-label"
                  value={draft.label}
                  disabled={saving}
                  onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                />
              </div>
              <div>
                <label htmlFor="edit-note" className="mb-1.5 block text-xs font-semibold text-muted-foreground">
                  Note
                </label>
                <Textarea
                  id="edit-note"
                  value={draft.note}
                  disabled={saving}
                  rows={3}
                  onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
                />
              </div>
            </div>
          ) : (
            <div className="h-[min(60vh,520px)]">
              <SimulationsStep
                draft={draft}
                onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
              />
            </div>
          )}
          {error && (
            <div className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-border p-4">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Annuler
          </Button>
          <Button type="button" onClick={handleSave} disabled={!canSave || saving}>
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
