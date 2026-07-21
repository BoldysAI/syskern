"use client";

/**
 * Modal to choose which simulation line columns are visible (catalog-style).
 */

import { useState } from "react";
import { Columns } from "@phosphor-icons/react";
import { AppModal } from "@/components/AppModal";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  availableSimulationColumns,
  DEFAULT_VISIBLE_SIMULATION_COLUMNS,
  ensureLockedSimulationColumns,
} from "./simulation-column-storage";

interface SimulationColumnsDialogProps {
  isProject: boolean;
  visibleKeys: string[];
  onApply: (keys: string[]) => void;
}

export function SimulationColumnsDialog({
  isProject,
  visibleKeys,
  onApply,
}: SimulationColumnsDialogProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(visibleKeys);

  const columns = availableSimulationColumns(isProject);

  const openDialog = () => {
    setDraft(ensureLockedSimulationColumns(visibleKeys, isProject));
    setOpen(true);
  };

  const handleOpenChange = (next: boolean) => {
    if (next) setDraft(ensureLockedSimulationColumns(visibleKeys, isProject));
    setOpen(next);
  };

  const toggle = (key: string, locked?: boolean) => {
    if (locked) return;
    setDraft((prev) => {
      const set = new Set(prev);
      if (set.has(key)) set.delete(key);
      else set.add(key);
      return ensureLockedSimulationColumns([...set], isProject);
    });
  };

  const handleReset = () => {
    setDraft(ensureLockedSimulationColumns(DEFAULT_VISIBLE_SIMULATION_COLUMNS, isProject));
  };

  const handleApply = () => {
    onApply(ensureLockedSimulationColumns(draft, isProject));
    setOpen(false);
  };

  const selectedCount = draft.length;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        title="Choisir les colonnes"
        className="gap-1.5"
        onClick={openDialog}
      >
        <Columns size={15} />
        <span className="hidden sm:inline">Colonnes</span>
        {selectedCount > 0 && (
          <span className="text-xs text-muted-foreground">({selectedCount})</span>
        )}
      </Button>

      <AppModal
        open={open}
        onOpenChange={handleOpenChange}
        title="Colonnes de la simulation"
        description="Cochez les colonnes à afficher dans le tableau. Le SKU reste toujours visible."
        size="lg"
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={handleReset}>
              Réinitialiser
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Annuler
              </Button>
              <Button type="button" onClick={handleApply}>
                Appliquer
              </Button>
            </div>
          </div>
        }
      >
        <ul className="flex max-h-[min(60vh,28rem)] flex-col gap-2 overflow-y-auto pr-1">
          {columns.map((col) => {
            const checked = draft.includes(col.key);
            return (
              <li key={col.key}>
                <label
                  className={
                    col.locked
                      ? "flex cursor-default items-center gap-3 rounded-lg px-2 py-2 opacity-70"
                      : "flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/60"
                  }
                >
                  <Checkbox
                    checked={checked}
                    disabled={col.locked}
                    onCheckedChange={() => toggle(col.key, col.locked)}
                  />
                  <span className="text-sm text-foreground">{col.label}</span>
                  {col.locked && (
                    <span className="text-xs text-muted-foreground">(toujours affiché)</span>
                  )}
                </label>
              </li>
            );
          })}
        </ul>
      </AppModal>
    </>
  );
}
