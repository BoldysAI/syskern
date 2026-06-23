"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Database, Loader2, RefreshCw, Settings2, X } from "lucide-react";
import { recalculateSimulation, type RecalcScope } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Props {
  simId: string;
  lineCount: number;
  marketParams?: Record<string, unknown>;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}

const SCOPES: {
  id: RecalcScope;
  label: string;
  description: string;
  icon: typeof Settings2;
}[] = [
  {
    id: "params_only",
    label: "Paramètres actuels uniquement",
    description: "Applique les paramètres modifiés à toutes les lignes, sans rafraîchir Odoo.",
    icon: Settings2,
  },
  {
    id: "with_odoo_refresh",
    label: "Rafraîchir Odoo + recalcul",
    description: "Récupère stock, PAMP et achats engagés frais depuis Odoo, puis recalcule.",
    icon: RefreshCw,
  },
  {
    id: "full_refresh",
    label: "Rafraîchissement complet",
    description: "Actualise les paramètres marché actifs + Odoo, puis recalcule.",
    icon: Database,
  },
];

export function RecalculateModal({ simId, lineCount, marketParams, open, onClose, onDone }: Props) {
  const [scope, setScope] = useState<RecalcScope>("params_only");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const estimateSec = Math.max(2, Math.round(lineCount / 40));

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
      // Odoo is decoupled: the recalc succeeds even if the refresh degraded.
      // Surface a non-blocking notice and keep the modal open so the user sees it.
      if (result?.odoo_refresh_error) {
        setNotice(
          `Recalcul effectué sur les paramètres courants. Rafraîchissement Odoo indisponible : ${result.odoo_refresh_error}`
        );
      } else {
        onClose();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Recalcul échoué.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && !running && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white shadow-xl focus:outline-none">
          <div className="flex items-center justify-between border-b border-[#E2E8F0] p-5">
            <Dialog.Title className="text-lg font-semibold text-slate-900">
              Recalculer la simulation
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
                    active
                      ? "border-[#E07200] bg-[#FFF3E0]"
                      : "border-[#E2E8F0] hover:bg-slate-50"
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                      active ? "border-[#E07200]" : "border-slate-300"
                    )}
                  >
                    {active && <span className="h-2.5 w-2.5 rounded-full bg-[#E07200]" />}
                  </span>
                  <Icon size={18} className={cn("mt-0.5 shrink-0", active ? "text-[#C56400]" : "text-slate-400")} />
                  <span>
                    <span className="block text-sm font-semibold text-slate-800">{s.label}</span>
                    <span className="mt-0.5 block text-xs text-slate-500">{s.description}</span>
                  </span>
                </button>
              );
            })}

            <p className="text-xs text-slate-400">
              Estimation : ~{estimateSec}s pour {lineCount} ligne{lineCount !== 1 ? "s" : ""}.
            </p>

            {running && (
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div className="h-full w-full animate-pulse rounded-full bg-[#E07200]" />
              </div>
            )}
            {error && (
              <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
            )}
            {notice && (
              <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
                {notice}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-[#E2E8F0] p-4">
            <button
              type="button"
              onClick={onClose}
              disabled={running}
              className="rounded-lg border border-[#E2E8F0] px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handleRun}
              disabled={running}
              className="flex items-center gap-2 rounded-lg bg-[#E07200] px-4 py-2 text-sm font-semibold text-white hover:bg-[#C56400] disabled:opacity-50"
            >
              {running && <Loader2 size={14} className="animate-spin" />}
              Lancer le recalcul
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
