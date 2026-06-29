"use client";

import { useState } from "react";
import { Database, CircleNotch, ArrowsClockwise, Gear } from "@phosphor-icons/react";
import { recalculateSimulation, type RecalcScope } from "@/lib/api";
import { humanizeApiError } from "@/lib/humanize-errors";
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
  marketParams?: Record<string, unknown>;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}

const SCOPES: {
  id: RecalcScope;
  label: string;
  description: string;
  icon: typeof Gear;
}[] = [
  {
    id: "params_only",
    label: "Paramètres actuels uniquement",
    description: "Applique les paramètres modifiés à toutes les lignes, sans rafraîchir Odoo.",
    icon: Gear,
  },
  {
    id: "with_odoo_refresh",
    label: "Rafraîchir Odoo + recalcul",
    description: "Récupère stock, PAMP et achats engagés frais depuis Odoo, puis recalcule.",
    icon: ArrowsClockwise,
  },
  {
    id: "full_refresh",
    label: "Rafraîchissement complet",
    description: "Actualise les paramètres marché actifs + Odoo, puis recalcule.",
    icon: Database,
  },
];

export function RecalculateModal({ simId, marketParams, open, onClose, onDone }: Props) {
  const [scope, setScope] = useState<RecalcScope>("params_only");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const handleRun = async () => {
    setRunning(true);
    setError(null);
    setNotice(null);
    try {
      const result = await recalculateSimulation(simId, {
        scope,
        market_params: marketParams as Record<string, string> | undefined,
      });
      onDone();
      if (result?.odoo_refresh_error) {
        setNotice(
          `Recalcul effectué sur les paramètres courants. Rafraîchissement Odoo indisponible : ${result.odoo_refresh_error}`
        );
      } else {
        onClose();
      }
    } catch (e) {
      setError(humanizeApiError(e, "Recalcul échoué."));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !running && onClose()}>
      <DialogContent className="max-w-lg gap-0 p-0" showCloseButton={!running}>
        <DialogHeader className="border-b border-border p-5">
          <DialogTitle>Recalculer la simulation</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3 p-5">
          {SCOPES.map((s) => {
            const Icon = s.icon;
            const active = scope === s.id;
            return (
              <button
                type="button"
                key={s.id}
                disabled={running}
                onClick={() => setScope(s.id)}
                className={cn(
                  "flex items-start gap-3 rounded-xl border p-3 text-left transition-colors disabled:opacity-60",
                  active ? "border-primary bg-accent" : "border-border hover:bg-muted"
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                    active ? "border-primary" : "border-border"
                  )}
                >
                  {active && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}
                </span>
                <Icon
                  size={18}
                  className={cn("mt-0.5 shrink-0", active ? "text-accent-foreground" : "text-muted-foreground")}
                />
                <span>
                  <span className="block text-sm font-semibold text-foreground">{s.label}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{s.description}</span>
                </span>
              </button>
            );
          })}

          {running && (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full w-full animate-pulse rounded-full bg-primary" />
            </div>
          )}
          {error && (
            <div className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
          )}
          {notice && (
            <div className="rounded-lg border border-warm/30 bg-warm/10 px-3 py-2 text-sm text-warm">
              {notice}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={running}>
            Annuler
          </Button>
          <Button type="button" onClick={handleRun} disabled={running} className="gap-2">
            {running && <CircleNotch size={14} className="animate-spin" />}
            Lancer le recalcul
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
