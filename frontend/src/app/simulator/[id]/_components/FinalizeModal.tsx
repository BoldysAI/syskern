"use client";

import { useState } from "react";
import { Warning, CheckCircle, CircleNotch, Lock } from "@phosphor-icons/react";
import { finalizeSimulation } from "@/lib/api";
import { cn } from "@/lib/utils";
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
  onDone: () => void;
}

const CONSEQUENCES = [
  "La simulation passe en lecture seule : plus aucune modification possible.",
  "Le recalcul est désactivé.",
  "Elle reste consultable et peut servir de base aux offres commerciales.",
  "Action irréversible (vous pourrez seulement l'archiver).",
];

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
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-lg gap-0 p-0" showCloseButton={!running}>
        <DialogHeader className="border-b border-border p-5">
          <DialogTitle className="flex items-center gap-2">
            <Lock size={18} className="text-primary" />
            Finaliser la simulation
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 p-5">
          <div className="rounded-xl border border-warm/30 bg-warm/10 p-3">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-warm">
              <Warning size={15} weight="fill" />
              Conséquences de la finalisation
            </p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {CONSEQUENCES.map((c) => (
                <li key={c} className="flex items-start gap-2 text-xs text-foreground">
                  <CheckCircle size={13} className="mt-0.5 shrink-0 text-primary" />
                  {c}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <label htmlFor="finalize-confirm" className="block text-xs font-semibold text-muted-foreground">
              Pour confirmer, saisissez le libellé de la simulation :
            </label>
            <p className="mt-1 select-none text-sm font-semibold text-foreground">{simLabel}</p>
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
              className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          {error && (
            <div className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <p>{error.detail}</p>
              {error.errors.length > 0 && (
                <ul className="mt-1.5 list-inside list-disc text-xs">
                  {error.errors.map((sku) => (
                    <li key={sku}>{sku}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-border p-4">
          <Button type="button" variant="outline" onClick={close} disabled={running}>
            Annuler
          </Button>
          <Button
            type="button"
            onClick={handleFinalize}
            disabled={!canConfirm}
            className={cn(
              "gap-2",
              canConfirm ? "bg-primary hover:bg-primary/90" : "bg-muted text-muted-foreground"
            )}
          >
            {running && <CircleNotch size={14} className="animate-spin" />}
            Finaliser
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
