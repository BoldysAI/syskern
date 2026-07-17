"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CircleNotch, Database, X } from "@phosphor-icons/react";
import { getCurrentMarketParameter, listMarketParameters } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { OptionSelect } from "@/components/OptionSelect";
import { cn } from "@/lib/utils";
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
  /**
   * Inside another dialog (compare params wizard): portal overlay with blur above the parent.
   * Nested `Dialog` + backdrop-filter is unreliable with @base-ui — use a dedicated layer instead.
   */
  nested?: boolean;
}

const inputCls =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30";
const labelCls = "mb-1.5 block text-xs font-semibold text-muted-foreground";

const COPPER_MARKET_OPTIONS = [
  { value: "LME", label: "LME (London)" },
  { value: "SHE", label: "SHE (Shanghai)" },
] as const;

const COPPER_CURRENCY_OPTIONS = [
  { value: "RMB", label: "RMB" },
  { value: "USD", label: "USD" },
  { value: "EUR", label: "EUR" },
] as const;

function MarketParamsPanel({
  draft,
  setDraft,
  prefilling,
  note,
  onPrefill,
  onCancel,
  onSave,
  className,
}: {
  draft: MarketParamsDraft;
  setDraft: React.Dispatch<React.SetStateAction<MarketParamsDraft>>;
  prefilling: boolean;
  note: string | null;
  onPrefill: () => void;
  onCancel: () => void;
  onSave: () => void;
  className?: string;
}) {
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
          convertCopperDraftPrice(d.copper_current_price, from, next, fx) ?? d.copper_current_price,
      };
    });
  };

  return (
    <div className={cn("flex flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/10", className)}>
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h2 className="font-heading text-base font-medium text-foreground">Paramètres marché</h2>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Fermer"
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex flex-col gap-4 p-5">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Marché cuivre</label>
            <OptionSelect
              value={draft.copper_market ?? "LME"}
              onValueChange={(v) => set({ copper_market: v as "LME" | "SHE" })}
              options={COPPER_MARKET_OPTIONS}
            />
          </div>
          <div>
            <label className={labelCls}>Devise cuivre</label>
            <OptionSelect
              value={currency}
              onValueChange={(v) => onCurrencyChange(v as CopperCurrency)}
              options={COPPER_CURRENCY_OPTIONS}
            />
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={onPrefill}
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

      <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-border p-4 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancel}>
          Annuler
        </Button>
        <Button type="button" onClick={onSave}>
          Enregistrer
        </Button>
      </div>
    </div>
  );
}

export function MarketParamsModal({ open, onOpenChange, value, onSave, nested = false }: Props) {
  const [draft, setDraft] = useState<MarketParamsDraft>(value);
  const [prefilling, setPrefilling] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setDraft(value);
      setNote(null);
    }
    onOpenChange(next);
  };

  const prefill = async () => {
    setPrefilling(true);
    setNote(null);
    const next: MarketParamsDraft = { ...draft };
    let fieldsFilled = 0;
    const market = next.copper_market ?? "LME";

    const assign = (key: keyof MarketParamsDraft, val: string | null | undefined) => {
      if (val?.trim()) {
        (next as unknown as Record<string, string>)[key] = val;
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

  const save = () => {
    onSave(draft);
    handleOpenChange(false);
  };

  const panel = (
    <MarketParamsPanel
      draft={draft}
      setDraft={setDraft}
      prefilling={prefilling}
      note={note}
      onPrefill={() => void prefill()}
      onCancel={() => handleOpenChange(false)}
      onSave={save}
    />
  );

  if (nested) {
    if (!open || !mounted) return null;
    return createPortal(
      <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
        <button
          type="button"
          className="absolute inset-0 bg-black/50 backdrop-blur-md"
          aria-label="Fermer"
          onClick={() => handleOpenChange(false)}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="market-params-nested-title"
          className="relative z-10 w-full max-w-md animate-in fade-in-0 zoom-in-95 duration-150"
          onClick={(e) => e.stopPropagation()}
        >
          <span id="market-params-nested-title" className="sr-only">
            Paramètres marché
          </span>
          {panel}
        </div>
      </div>,
      document.body,
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md gap-0 overflow-hidden p-0">
        <MarketParamsPanel
          draft={draft}
          setDraft={setDraft}
          prefilling={prefilling}
          note={note}
          onPrefill={() => void prefill()}
          onCancel={() => handleOpenChange(false)}
          onSave={save}
          className="rounded-none border-0 shadow-none ring-0"
        />
      </DialogContent>
    </Dialog>
  );
}
