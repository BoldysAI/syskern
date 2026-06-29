"use client";

import { useState } from "react";
import { CircleNotch, Database } from "@phosphor-icons/react";
import { getCurrentMarketParameter, listMarketParameters } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { MarketParamsDraft } from "./wizard-draft";
import {
  convertCopperDraftPrice,
  copperHistoryForMarket,
  copperPriceInCurrency,
  normalizeCopperCurrency,
  type CopperCurrency,
} from "./market-prefill";

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

  const currency = draft.copper_currency ?? "RMB";

  const onCurrencyChange = (next: CopperCurrency) => {
    setDraft((d) => {
      const from = normalizeCopperCurrency(d.copper_currency);
      const fx = { eurRmb: d.fx_eur_rmb, eurUsd: d.fx_eur_usd };
      return {
        ...d,
        copper_currency: next,
        copper_base_price:
          convertCopperDraftPrice(d.copper_base_price, from, next, fx) ?? d.copper_base_price,
        copper_current_price:
          convertCopperDraftPrice(d.copper_current_price, from, next, fx) ??
          d.copper_current_price,
      };
    });
  };

  const prefill = async () => {
    setPrefilling(true);
    setNote(null);
    const next: MarketParamsDraft = { ...draft };
    let fieldsFilled = 0;
    const market = next.copper_market ?? "LME";

    const assign = (key: keyof MarketParamsDraft, val: string | null | undefined) => {
      if (val?.trim()) {
        next[key] = val as MarketParamsDraft[typeof key];
        fieldsFilled += 1;
      }
    };

    const tryFetch = async (fn: () => Promise<void>) => {
      try {
        await fn();
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
      if (fx.fx_rate) assign("fx_eur_rmb", fx.fx_rate);
    });
    await tryFetch(async () => {
      const fx = await getCurrentMarketParameter({
        parameter_type: "fx_rate",
        fx_from_currency: "EUR",
        fx_to_currency: "USD",
      });
      if (fx.fx_rate) assign("fx_eur_usd", fx.fx_rate);
    });

    const fx = { eurRmb: next.fx_eur_rmb, eurUsd: next.fx_eur_usd };

    await tryFetch(async () => {
      const copper = await getCurrentMarketParameter({
        parameter_type: "copper_price",
        copper_market: market,
      });
      assign(
        "copper_current_price",
        copperPriceInCurrency(copper, normalizeCopperCurrency(next.copper_currency), fx),
      );
    });

    try {
      const history = await listMarketParameters({
        type: "copper_price",
        copperMarket: market,
      });
      const sorted = copperHistoryForMarket(history, market);
      const baseParam = sorted.length >= 2 ? sorted[1] : sorted[0];
      if (baseParam) {
        assign(
          "copper_base_price",
          copperPriceInCurrency(baseParam, normalizeCopperCurrency(next.copper_currency), fx),
        );
      }
    } catch {
      // History unavailable — copper base left as-is.
    }

    setDraft(next);
    setPrefilling(false);
    setNote(
      fieldsFilled > 0
        ? `Valeurs pré-remplies (${market}, ${next.copper_currency}).`
        : `Aucun paramètre cuivre ${market} trouvé dans les paramètres marché.`,
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md gap-0 p-0">
        <DialogHeader className="border-b border-border p-5">
          <DialogTitle>Paramètres marché</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 p-5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Marché cuivre</label>
              <Select
                value={draft.copper_market ?? "LME"}
                onValueChange={(v) => set({ copper_market: v as "LME" | "SHE" })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LME">LME (London)</SelectItem>
                  <SelectItem value="SHE">SHE (Shanghai)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className={labelCls}>Devise cuivre</label>
              <Select value={currency} onValueChange={(v) => onCurrencyChange(v as CopperCurrency)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="RMB">RMB</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={prefill}
            disabled={prefilling}
            className="gap-2"
          >
            {prefilling ? (
              <CircleNotch size={15} className="animate-spin" />
            ) : (
              <Database size={15} />
            )}
            Pré-remplir depuis les paramètres actifs
          </Button>
          {note && <p className="text-xs text-muted-foreground">{note}</p>}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Cuivre base ({currency})</label>
              <input
                value={draft.copper_base_price}
                onChange={(e) => set({ copper_base_price: e.target.value })}
                inputMode="decimal"
                placeholder={currency === "RMB" ? "70000" : currency === "USD" ? "9500" : "8800"}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Cuivre actuel ({currency})</label>
              <input
                value={draft.copper_current_price}
                onChange={(e) => set({ copper_current_price: e.target.value })}
                inputMode="decimal"
                placeholder={currency === "RMB" ? "97000" : currency === "USD" ? "9700" : "9000"}
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
