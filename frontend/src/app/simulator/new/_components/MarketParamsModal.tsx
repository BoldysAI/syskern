"use client";

import { useState } from "react";
import { CircleNotch, Sparkle } from "@phosphor-icons/react";
import { getCurrentMarketParameter } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { MarketParamsDraft } from "./wizard-draft";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: MarketParamsDraft;
  onSave: (value: MarketParamsDraft) => void;
}

const inputCls =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30";
const labelCls = "mb-1.5 block text-xs font-semibold text-muted-foreground";

export function MarketParamsModal({ open, onOpenChange, value, onSave }: Props) {
  const [draft, setDraft] = useState<MarketParamsDraft>(value);
  const [prefilling, setPrefilling] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setDraft(value);
      setNote(null);
    }
    onOpenChange(next);
  };

  const set = (patch: Partial<MarketParamsDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const prefill = async () => {
    setPrefilling(true);
    setNote(null);
    const next: MarketParamsDraft = { ...draft };
    let filled = 0;
    const tryFetch = async (fn: () => Promise<void>) => {
      try {
        await fn();
        filled += 1;
      } catch {
        // No active parameter for this dimension — leave the field as-is.
      }
    };
    await tryFetch(async () => {
      const fx = await getCurrentMarketParameter({
        parameter_type: "fx_rate",
        fx_from_currency: "EUR",
        fx_to_currency: "RMB",
      });
      if (fx.fx_rate) next.fx_eur_rmb = fx.fx_rate;
    });
    await tryFetch(async () => {
      const fx = await getCurrentMarketParameter({
        parameter_type: "fx_rate",
        fx_from_currency: "EUR",
        fx_to_currency: "USD",
      });
      if (fx.fx_rate) next.fx_eur_usd = fx.fx_rate;
    });
    await tryFetch(async () => {
      const copper = await getCurrentMarketParameter({ parameter_type: "copper_price" });
      if (copper.copper_price && copper.copper_currency === "RMB") {
        next.copper_current_price_rmb = copper.copper_price;
      }
    });
    setDraft(next);
    setPrefilling(false);
    setNote(
      filled > 0
        ? "Valeurs pré-remplies depuis les paramètres marché actifs."
        : "Aucun paramètre marché actif compatible trouvé."
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md gap-0 p-0">
        <DialogHeader className="border-b border-border p-5">
          <DialogTitle>Paramètres marché</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 p-5">
          <Button
            type="button"
            variant="outline"
            onClick={prefill}
            disabled={prefilling}
            className="gap-2"
          >
            {prefilling ? <CircleNotch size={15} className="animate-spin" /> : <Sparkle size={15} />}
            Pré-remplir depuis les paramètres actifs
          </Button>
          {note && <p className="text-xs text-muted-foreground">{note}</p>}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Cuivre base (RMB)</label>
              <input
                value={draft.copper_base_price_rmb}
                onChange={(e) => set({ copper_base_price_rmb: e.target.value })}
                inputMode="decimal"
                placeholder="70000"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Cuivre actuel (RMB)</label>
              <input
                value={draft.copper_current_price_rmb}
                onChange={(e) => set({ copper_current_price_rmb: e.target.value })}
                inputMode="decimal"
                placeholder="97000"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>FX EUR→RMB</label>
              <input
                value={draft.fx_eur_rmb}
                onChange={(e) => set({ fx_eur_rmb: e.target.value })}
                inputMode="decimal"
                placeholder="7.95"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>FX EUR→USD</label>
              <input
                value={draft.fx_eur_usd}
                onChange={(e) => set({ fx_eur_usd: e.target.value })}
                inputMode="decimal"
                placeholder="1.15"
                className={inputCls}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            type="button"
            onClick={() => {
              onSave(draft);
              onOpenChange(false);
            }}
          >
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
