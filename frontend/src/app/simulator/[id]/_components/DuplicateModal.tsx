"use client";

import { useState } from "react";
import { Copy, CircleNotch } from "@phosphor-icons/react";
import { duplicateSimulation } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-md gap-0 p-0" showCloseButton={!running}>
        <DialogHeader className="border-b border-border p-5">
          <DialogTitle className="flex items-center gap-2">
            <Copy size={18} className="text-warm" />
            Dupliquer la simulation
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3 p-5">
          <p className="text-sm text-muted-foreground">
            Une copie en brouillon sera créée avec ses lignes (surcharges et derniers résultats
            figés). Les offres associées ne sont pas copiées.
          </p>
          <div>
            <label htmlFor="duplicate-label" className="mb-1.5 block text-xs font-semibold text-muted-foreground">
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
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          {error && (
            <div className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
          )}
        </div>

        <DialogFooter className="border-t border-border p-4">
          <Button type="button" variant="outline" onClick={close} disabled={running}>
            Annuler
          </Button>
          <Button
            type="button"
            onClick={handleDuplicate}
            disabled={running || !label.trim()}
            className="gap-2"
          >
            {running && <CircleNotch size={14} className="animate-spin" />}
            Dupliquer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
