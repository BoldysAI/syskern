"use client";

import { SimulationParamsFields } from "@/app/simulator/_components/SimulationParamsFields";
import {
  type ChainDraft,
  type MarketParamsDraft,
  type SymeaPosition,
  type WizardDraft,
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
  issues?: string[];
}

/** Wizard step 3 — delegates to `SimulationParamsFields` (canonical layout). */
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
  issues = [],
}: Props) {
  const draft = {
    label: "",
    type: "tariff" as const,
    clientIds: [],
    projectName: "",
    selectedSkus: [],
    notFoundSkus: [],
    marketParams,
    purchaseChain,
    saleChain,
    mixPct,
    symeaPct,
    syskernPct,
    symeaPosition,
    saleIncoterm,
    saleIncotermLocation,
  } satisfies WizardDraft;

  const onChange = (patch: Partial<WizardDraft>) => {
    if (patch.marketParams !== undefined) onMarketParams(patch.marketParams);
    if (patch.purchaseChain !== undefined) onPurchaseChain(patch.purchaseChain);
    if (patch.saleChain !== undefined) onSaleChain(patch.saleChain);
    if (patch.mixPct !== undefined) onMixPct(patch.mixPct);
    if (patch.symeaPct !== undefined) onSymeaPct(patch.symeaPct);
    if (patch.syskernPct !== undefined) onSyskernPct(patch.syskernPct);
    if (patch.symeaPosition !== undefined) onSymeaPosition(patch.symeaPosition);
    if (patch.saleIncoterm !== undefined) onSaleIncoterm(patch.saleIncoterm);
    if (patch.saleIncotermLocation !== undefined) onSaleIncotermLocation(patch.saleIncotermLocation);
  };

  return (
    <SimulationParamsFields
      draft={draft}
      onChange={onChange}
      issues={issues}
      introText={introText}
      showImportPreset
    />
  );
}
