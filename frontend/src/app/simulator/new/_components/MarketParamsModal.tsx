"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Loader2, Sparkles, X } from "lucide-react";
import { getCurrentMarketParameter } from "@/lib/api";
import type { MarketParamsDraft } from "./wizard-draft";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: MarketParamsDraft;
  onSave: (value: MarketParamsDraft) => void;
}

const inputCls =
  "w-full px-3 py-2 text-sm border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#E07200]/30 focus:border-[#E07200]";
const labelCls = "block text-xs font-semibold text-slate-600 mb-1.5";

export function MarketParamsModal({ open, onOpenChange, value, onSave }: Props) {
  const [draft, setDraft] = useState<MarketParamsDraft>(value);
  const [prefilling, setPrefilling] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // Sync local state when the dialog (re)opens with fresh props.
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
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white shadow-xl focus:outline-none">
          <div className="flex items-center justify-between p-5 border-b border-[#E2E8F0]">
            <Dialog.Title className="text-lg font-semibold text-slate-900">
              Paramètres marché
            </Dialog.Title>
            <Dialog.Close className="text-slate-400 hover:text-slate-600" aria-label="Fermer">
              <X size={20} />
            </Dialog.Close>
          </div>

          <div className="p-5 flex flex-col gap-4">
            <button
              type="button"
              onClick={prefill}
              disabled={prefilling}
              className="flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-[#C56400] border border-[#E07200]/40 rounded-lg hover:bg-[#FFF3E0] disabled:opacity-50"
            >
              {prefilling ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
              Pré-remplir depuis les paramètres actifs
            </button>
            {note && <p className="text-xs text-slate-500">{note}</p>}

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

            <div className="flex gap-3 pt-2">
              <Dialog.Close className="flex-1 text-center py-2.5 text-sm border border-[#E2E8F0] rounded-lg hover:bg-slate-50 text-slate-600">
                Annuler
              </Dialog.Close>
              <button
                type="button"
                onClick={() => {
                  onSave(draft);
                  onOpenChange(false);
                }}
                className="flex-1 py-2.5 text-sm bg-[#E07200] hover:bg-[#C56400] text-white rounded-lg font-semibold"
              >
                Enregistrer
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
