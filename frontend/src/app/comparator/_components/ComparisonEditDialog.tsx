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
import { AppModal } from "@/components/AppModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SimulationsStep } from "@/app/comparator/new/_components/SimulationsStep";
import {
  MAX_COMPARE_COLUMNS,
  type ComparisonWizardDraft,
} from "@/app/comparator/new/_components/wizard-draft";
import { cn } from "@/lib/utils";

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
    <AppModal
      open={open}
      onOpenChange={(o) => {
        if (!o && !saving) onClose();
      }}
      title="Modifier la comparaison"
      description="Nom, note et sélection des simulations comparées."
      size="full"
      footer={
        <div className="flex w-full justify-end gap-3 border-t border-border px-5 py-4">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Annuler
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={!canSave || saving}>
            <PencilSimple size={16} />
            Enregistrer
          </Button>
        </div>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex border-b border-border">
          <button
            type="button"
            onClick={() => setTab("meta")}
            className={cn(
              "flex-1 py-2.5 text-sm font-medium transition-colors",
              tab === "meta"
                ? "border-b-2 border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Nom et note
          </button>
          <button
            type="button"
            onClick={() => setTab("sims")}
            className={cn(
              "flex-1 py-2.5 text-sm font-medium transition-colors",
              tab === "sims"
                ? "border-b-2 border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Simulations
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto py-4">
          {tab === "meta" ? (
            <div className="mx-auto max-w-lg space-y-4">
              <div>
                <label
                  htmlFor="edit-label"
                  className="mb-1.5 block text-xs font-semibold text-muted-foreground"
                >
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
                <label
                  htmlFor="edit-note"
                  className="mb-1.5 block text-xs font-semibold text-muted-foreground"
                >
                  Note
                </label>
                <Textarea
                  id="edit-note"
                  value={draft.note}
                  disabled={saving}
                  rows={4}
                  onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
                />
              </div>
            </div>
          ) : (
            <div className="h-[min(72vh,720px)] min-h-[480px]">
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
      </div>
    </AppModal>
  );
}
