"use client";

import { useState } from "react";
import { Warning, CheckCircle, CircleNotch, Lock } from "@phosphor-icons/react";
import { finalizeSimulation } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useUiTranslate } from "@/lib/use-ui-translate";
import type { MessageKey } from "@/lib/i18n";
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

const CONSEQUENCE_KEYS: MessageKey[] = [
  "simulator.finalize.readonly",
  "simulator.finalize.recalcOff",
  "simulator.finalize.stillUsable",
  "simulator.finalize.irreversible",
];

function parseFinalizeError(e: unknown, fallbackDetail: string): { detail: string; errors: string[] } {
  const fallback = { detail: fallbackDetail, errors: [] as string[] };
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
  const t = useUiTranslate();
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
      setError(parseFinalizeError(e, t("simulator.finalize.failed")));
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
            {t("simulator.finalize.title")}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 p-5">
          <div className="rounded-xl border border-warm/30 bg-warm/10 p-3">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-warm">
              <Warning size={15} weight="fill" />
              {t("simulator.finalize.consequences")}
            </p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {CONSEQUENCE_KEYS.map((key) => (
                <li key={key} className="flex items-start gap-2 text-xs text-foreground">
                  <CheckCircle size={13} className="mt-0.5 shrink-0 text-primary" />
                  {t(key)}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <label htmlFor="finalize-confirm" className="block text-xs font-semibold text-muted-foreground">
              {t("simulator.finalize.confirmLabel")}
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
              placeholder={t("simulator.finalize.placeholder")}
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

        <DialogFooter>
          <Button type="button" variant="outline" onClick={close} disabled={running}>
            {t("common.cancel")}
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
            {t("simulator.detail.finalize")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
