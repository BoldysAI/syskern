"use client";

import { useState } from "react";
import useSWR from "swr";
import { Pencil, Wand2 } from "lucide-react";
import { listTransportModes, type TransportMode } from "@/lib/api";
import { cn } from "@/lib/utils";
import { StockPurchaseMixSlider } from "@/app/simulator/_components/StockPurchaseMixSlider";
import {
  SaleIncotermFields,
  useIncotermPrefillConfirm,
} from "@/app/simulator/_components/SaleIncotermSection";
import { chainDraftHasContent, suggestSaleChainDraft } from "@/lib/incoterms";
import { ChainBuilder } from "./ChainBuilder";
import { MarketParamsModal } from "./MarketParamsModal";
import {
  applyImportChinePreset,
  type ChainDraft,
  type MarketParamsDraft,
  type SymeaPosition,
} from "./wizard-draft";

interface Props {
  marketParams: MarketParamsDraft;
  purchaseChain: ChainDraft;
  saleChain: ChainDraft;
  mixPct: number;
  symeaPct: string;
  syskernPct: string;
  symeaPosition: SymeaPosition;
  saleIncoterm: string;
  saleIncotermLocation: string;
  onMarketParams: (v: MarketParamsDraft) => void;
  onPurchaseChain: (v: ChainDraft) => void;
  onSaleChain: (v: ChainDraft) => void;
  onMixPct: (v: number) => void;
  onSymeaPct: (v: string) => void;
  onSyskernPct: (v: string) => void;
  onSymeaPosition: (v: SymeaPosition) => void;
  onSaleIncoterm: (v: string) => void;
  onSaleIncotermLocation: (v: string) => void;
  introText?: string;
}

const labelCls = "block text-xs font-semibold text-slate-600 mb-1.5";
const inputCls =
  "w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary";

function MarketValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-800 tabular-nums">{value || "—"}</span>
    </div>
  );
}

export function ParamsStep({
  marketParams,
  purchaseChain,
  saleChain,
  mixPct,
  symeaPct,
  syskernPct,
  symeaPosition,
  saleIncoterm,
  saleIncotermLocation,
  onMarketParams,
  onPurchaseChain,
  onSaleChain,
  onMixPct,
  onSymeaPct,
  onSyskernPct,
  onSymeaPosition,
  onSaleIncoterm,
  onSaleIncotermLocation,
  introText = "Configurez les paramètres marché et les chaînes de calcul. Les résultats seront calculés après création (clic sur « Recalculer »).",
}: Props) {
  const [marketOpen, setMarketOpen] = useState(false);
  const { request: requestPrefill, modal: prefillModal } = useIncotermPrefillConfirm();
  const { data: transportModes } = useSWR<TransportMode[]>("transport-modes-active", () =>
    listTransportModes(true)
  );

  const applySaleIncoterm = (code: string) => {
    requestPrefill(
      chainDraftHasContent(saleChain),
      `Chaîne PV pour ${code}`,
      `Proposer une structure de chaîne PV adaptée à l'incoterm ${code} ?`,
      () => {
        onSaleIncoterm(code);
        onSaleChain(suggestSaleChainDraft(code));
      }
    );
  };

  const applyPreset = () => {
    const { purchase, sale } = applyImportChinePreset();
    onPurchaseChain(purchase);
    onSaleChain(sale);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">{introText}</p>
        <button
          type="button"
          onClick={applyPreset}
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-accent-foreground border border-primary/40 rounded-lg hover:bg-accent/50"
        >
          <Wand2 size={15} />
          Preset « Standard import Chine »
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Market params */}
        <div className="border border-border rounded-xl bg-white shadow-sm p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-800">Marché</h3>
            <button
              type="button"
              onClick={() => setMarketOpen(true)}
              className="flex items-center gap-1.5 text-xs font-semibold text-accent-foreground hover:text-warm"
            >
              <Pencil size={13} />
              Modifier
            </button>
          </div>
          <MarketValue label="Cuivre base (RMB)" value={marketParams.copper_base_price_rmb} />
          <MarketValue label="Cuivre actuel (RMB)" value={marketParams.copper_current_price_rmb} />
          <MarketValue label="FX EUR→RMB" value={marketParams.fx_eur_rmb} />
          <MarketValue label="FX EUR→USD" value={marketParams.fx_eur_usd} />
        </div>

        {/* Global params */}
        <div className="border border-border rounded-xl bg-white shadow-sm p-4 flex flex-col gap-4 lg:col-span-2">
          <h3 className="text-sm font-bold text-slate-800">Paramètres globaux</h3>

          <StockPurchaseMixSlider
            title="Mix stock / achat global"
            value={mixPct}
            onChange={onMixPct}
          />

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Marge Symea (%)</label>
              <input
                type="number"
                min={0}
                max={99}
                step="0.1"
                value={symeaPct}
                onChange={(e) => onSymeaPct(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Marge Syskern (%)</label>
              <input
                type="number"
                min={0}
                max={99}
                step="0.1"
                value={syskernPct}
                onChange={(e) => onSyskernPct(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>

          <div>
            <label className={labelCls}>Position marge Symea</label>
            <div className="flex gap-2">
              {(["after_transports", "before_transports"] as SymeaPosition[]).map((pos) => (
                <button
                  type="button"
                  key={pos}
                  onClick={() => onSymeaPosition(pos)}
                  className={cn(
                    "flex-1 py-2 text-sm font-medium rounded-lg border transition-colors",
                    symeaPosition === pos
                      ? "border-primary bg-accent text-accent-foreground"
                      : "border-border text-slate-600 hover:bg-slate-50"
                  )}
                >
                  {pos === "after_transports" ? "Après transports" : "Avant transports"}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="border border-border rounded-xl bg-white shadow-sm p-4">
        <h3 className="text-sm font-bold text-slate-800 mb-3">Incoterm de vente</h3>
        <SaleIncotermFields
          incoterm={saleIncoterm}
          location={saleIncotermLocation}
          onIncotermChange={applySaleIncoterm}
          onLocationChange={onSaleIncotermLocation}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChainBuilder
          title="Chaîne PA (achat)"
          chain={purchaseChain}
          isPurchase
          transportModes={transportModes ?? []}
          onChange={onPurchaseChain}
        />
        <ChainBuilder
          title="Chaîne PV (vente)"
          chain={saleChain}
          isPurchase={false}
          transportModes={transportModes ?? []}
          onChange={onSaleChain}
        />
      </div>

      <MarketParamsModal
        open={marketOpen}
        onOpenChange={setMarketOpen}
        value={marketParams}
        onSave={onMarketParams}
      />
      {prefillModal}
    </div>
  );
}
