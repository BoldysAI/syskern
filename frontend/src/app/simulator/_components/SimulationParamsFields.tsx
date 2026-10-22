"use client";

import { useState } from "react";
import useSWR from "swr";
import { MagicWand, PencilSimple } from "@phosphor-icons/react";
import { StockPurchaseMixSlider } from "@/app/simulator/_components/StockPurchaseMixSlider";
import {
  SaleIncotermFields,
  useIncotermPrefillConfirm,
} from "@/app/simulator/_components/SaleIncotermSection";
import { ChainBuilder } from "@/app/simulator/new/_components/ChainBuilder";
import { MarketParamsModal } from "@/app/simulator/new/_components/MarketParamsModal";
import { WizardStep3IssuesBanner } from "@/app/simulator/new/_components/WizardStep3IssuesBanner";
import {
  applyImportChinePreset,
  type SymeaPosition,
  type WizardDraft,
} from "@/app/simulator/new/_components/wizard-draft";
import {
  chainDraftHasContent,
  dominantPurchaseIncoterm,
  suggestPurchaseChainDraft,
  suggestSaleChainDraft,
} from "@/lib/incoterms";
import type { TransportMode } from "@/lib/api";
import { listTransportModes } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useUiTranslate } from "@/lib/use-ui-translate";

const labelCls = "block text-xs font-semibold text-muted-foreground mb-1.5";
const inputCls =
  "w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed";

function MarketValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground tabular-nums">{value || "—"}</span>
    </div>
  );
}

export interface SimulationParamsFieldsProps {
  draft: WizardDraft;
  onChange: (patch: Partial<WizardDraft>) => void;
  readOnly?: boolean;
  /** Supplier incoterms from simulation lines — for PA chain prefill. */
  supplierLines?: { incoterm?: string }[];
  transportModes?: TransportMode[];
  /** When set, market params are committed via this callback (e.g. sidebar autosave). */
  onMarketParamsSave?: (marketParams: WizardDraft["marketParams"]) => void | Promise<void>;
  /** Blurred backdrop on nested market-params dialog (inside AppModal). */
  nestedMarketModal?: boolean;
  /** Wizard step 3 — validation issues banner (optional). */
  issues?: string[];
  introText?: string;
  showImportPreset?: boolean;
}

/**
 * Canonical layout for simulation pricing parameters — mirrors wizard step 3
 * « Paramètres et chaîne » (`ParamsStep`). Reuse everywhere params are edited.
 */
export function SimulationParamsFields({
  draft,
  onChange,
  readOnly = false,
  supplierLines = [],
  transportModes: transportModesProp,
  onMarketParamsSave,
  issues = [],
  introText,
  showImportPreset = false,
  nestedMarketModal = false,
}: SimulationParamsFieldsProps) {
  const t = useUiTranslate();
  const [marketOpen, setMarketOpen] = useState(false);
  const { request: requestPrefill, modal: prefillModal } = useIncotermPrefillConfirm();

  const { data: fetchedModes } = useSWR<TransportMode[]>(
    transportModesProp ? null : "transport-modes-active",
    () => listTransportModes(true),
  );
  const transportModes = transportModesProp ?? fetchedModes ?? [];

  const update = (patch: Partial<WizardDraft>) => onChange(patch);

  const applySaleIncoterm = (code: string) => {
    requestPrefill(
      chainDraftHasContent(draft.saleChain),
      t("simulator.chain.pvFor", { code }),
      t("simulator.chain.suggestPv", { code }),
      () => update({ saleIncoterm: code, saleChain: suggestSaleChainDraft(code) }),
    );
  };

  const applyPurchaseFromSuppliers = () => {
    const dominant = dominantPurchaseIncoterm(supplierLines);
    requestPrefill(
      chainDraftHasContent(draft.purchaseChain),
      t("simulator.chain.paFor", { code: dominant }),
      t("simulator.chain.suggestPa", { code: dominant }),
      () => update({ purchaseChain: suggestPurchaseChainDraft(dominant) }),
    );
  };

  const applyPreset = () => {
    const { purchase, sale } = applyImportChinePreset();
    update({ purchaseChain: purchase, saleChain: sale });
  };

  const handleMarketSave = async (marketParams: WizardDraft["marketParams"]) => {
    update({ marketParams });
    if (onMarketParamsSave) {
      await onMarketParamsSave(marketParams);
    }
    setMarketOpen(false);
  };

  return (
    <div className="flex flex-col gap-6">
      {issues.length > 0 && <WizardStep3IssuesBanner issues={issues} />}

      {(introText || showImportPreset) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {introText ? <p className="text-sm text-muted-foreground">{introText}</p> : <span />}
          {showImportPreset && !readOnly && (
            <button
              type="button"
              onClick={applyPreset}
              className="flex items-center gap-2 rounded-lg border border-primary/40 px-3 py-2 text-sm font-medium text-accent-foreground hover:bg-accent/50"
            >
              <MagicWand size={15} />
              {t("simulator.preset.importChine")}
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-foreground">{t("simulator.market.section")}</h3>
            {!readOnly && (
              <button
                type="button"
                onClick={() => setMarketOpen(true)}
                className="flex items-center gap-1.5 text-xs font-semibold text-accent-foreground hover:text-warm"
              >
                <PencilSimple size={13} />
                {t("common.edit")}
              </button>
            )}
          </div>
          <MarketValue
            label={t("simulator.market.copperBase", {
              currency: draft.marketParams.copper_currency ?? "RMB",
            })}
            value={draft.marketParams.copper_base_price}
          />
          <MarketValue
            label={t("simulator.market.copperCurrent", {
              currency: draft.marketParams.copper_currency ?? "RMB",
            })}
            value={draft.marketParams.copper_current_price}
          />
          <MarketValue label={t("simulator.fx.eurToRmb")} value={draft.marketParams.fx_eur_rmb} />
          <MarketValue label={t("simulator.fx.eurToUsd")} value={draft.marketParams.fx_eur_usd} />
        </div>

        <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 shadow-sm lg:col-span-2">
          <h3 className="text-sm font-bold text-foreground">{t("simulator.params.global")}</h3>

          <StockPurchaseMixSlider
            title={t("simulator.params.mixGlobal")}
            value={draft.mixPct}
            disabled={readOnly}
            onChange={(mixPct) => update({ mixPct })}
          />

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>{t("simulator.params.symeaPct")}</label>
              <input
                type="number"
                min={0}
                max={99}
                step="0.1"
                value={draft.symeaPct}
                disabled={readOnly}
                onChange={(e) => update({ symeaPct: e.target.value })}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>{t("simulator.params.syskernPct")}</label>
              <input
                type="number"
                min={0}
                max={99}
                step="0.1"
                value={draft.syskernPct}
                disabled={readOnly}
                onChange={(e) => update({ syskernPct: e.target.value })}
                className={inputCls}
              />
            </div>
          </div>

          <div>
            <label className={labelCls}>{t("simulator.params.symeaPosition")}</label>
            <div className="flex gap-2">
              {(["after_transports", "before_transports"] as SymeaPosition[]).map((pos) => (
                <button
                  type="button"
                  key={pos}
                  disabled={readOnly}
                  onClick={() => update({ symeaPosition: pos })}
                  className={cn(
                    "flex-1 rounded-lg border py-2 text-sm font-medium transition-colors disabled:opacity-50",
                    draft.symeaPosition === pos
                      ? "border-primary bg-accent text-accent-foreground"
                      : "border-border text-muted-foreground hover:bg-muted",
                  )}
                >
                  {pos === "after_transports"
                    ? t("simulator.position.after")
                    : t("simulator.position.before")}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-bold text-foreground">{t("simulator.params.saleIncoterm")}</h3>
        <SaleIncotermFields
          incoterm={draft.saleIncoterm}
          location={draft.saleIncotermLocation}
          disabled={readOnly}
          onIncotermChange={applySaleIncoterm}
          onLocationChange={(saleIncotermLocation) => update({ saleIncotermLocation })}
        />
      </div>

      {!readOnly && supplierLines.length > 0 && (
        <button
          type="button"
          onClick={applyPurchaseFromSuppliers}
          className="self-start text-xs font-medium text-warm underline-offset-2 hover:text-accent-foreground hover:underline"
        >
          {t("simulator.params.adaptPurchase")}
        </button>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChainBuilder
          title={t("simulator.chain.purchase")}
          chain={draft.purchaseChain}
          isPurchase
          transportModes={transportModes}
          onChange={(v) => update({ purchaseChain: v })}
        />
        <ChainBuilder
          title={t("simulator.chain.sale")}
          chain={draft.saleChain}
          isPurchase={false}
          transportModes={transportModes}
          onChange={(v) => update({ saleChain: v })}
        />
      </div>

      <MarketParamsModal
        open={marketOpen}
        onOpenChange={setMarketOpen}
        value={draft.marketParams}
        onSave={(v) => void handleMarketSave(v)}
        nested={nestedMarketModal}
      />

      {prefillModal}
    </div>
  );
}
