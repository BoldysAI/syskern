import type { CopperMarket, MarketParameter } from "@/lib/api";

export type CopperCurrency = "RMB" | "USD" | "EUR";

type Fx = { eurRmb: string; eurUsd: string };

function parsePrice(s: string): number | null {
  const n = parseFloat(String(s));
  return Number.isFinite(n) ? n : null;
}

function formatCopper(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

function copperPerTonne(param: MarketParameter): number | null {
  if (!param.copper_price) return null;
  const price = parseFloat(String(param.copper_price));
  if (!Number.isFinite(price)) return null;
  const unit = (param.copper_unit ?? "tonne").toLowerCase();
  return unit === "kg" ? price * 1000 : price;
}

function toRmb(amount: number, from: CopperCurrency, fx: Fx): number | null {
  if (from === "RMB") return amount;
  const eurRmb = parsePrice(fx.eurRmb);
  const eurUsd = parsePrice(fx.eurUsd);
  if (from === "EUR") return eurRmb ? amount * eurRmb : null;
  if (from === "USD") {
    if (!eurRmb || !eurUsd || eurUsd === 0) return null;
    return amount * (eurRmb / eurUsd);
  }
  return null;
}

function fromRmb(rmb: number, to: CopperCurrency, fx: Fx): number | null {
  if (to === "RMB") return rmb;
  const eurRmb = parsePrice(fx.eurRmb);
  const eurUsd = parsePrice(fx.eurUsd);
  if (to === "EUR") return eurRmb ? rmb / eurRmb : null;
  if (to === "USD") {
    if (!eurRmb || !eurUsd || eurUsd === 0) return null;
    return rmb * (eurUsd / eurRmb);
  }
  return null;
}

/** Convert a wizard copper field to RMB/tonne for simulation market_params. */
export function copperDraftPriceToRmb(
  value: string,
  currency: CopperCurrency,
  fx: Fx,
): string | null {
  const n = parsePrice(value);
  if (n === null) return null;
  const rmb = toRmb(n, currency, fx);
  return rmb === null ? null : formatCopper(rmb);
}

/** Load stored RMB/tonne into the wizard display currency. */
export function copperRmbToDraft(
  rmbStr: string,
  currency: CopperCurrency,
  fx: Fx,
): string | null {
  const rmb = parsePrice(rmbStr);
  if (rmb === null) return null;
  const out = fromRmb(rmb, currency, fx);
  return out === null ? null : formatCopper(out);
}

export function convertCopperDraftPrice(
  value: string,
  from: CopperCurrency,
  to: CopperCurrency,
  fx: Fx,
): string | null {
  if (from === to) return value.trim() || null;
  const n = parsePrice(value);
  if (n === null) return null;
  const rmb = toRmb(n, from, fx);
  if (rmb === null) return null;
  return copperRmbToDraft(String(rmb), to, fx);
}

/** Map a settings copper record to the wizard currency (per tonne). */
export function copperPriceInCurrency(
  param: MarketParameter,
  target: CopperCurrency,
  fx?: Fx,
): string | null {
  const perTonne = copperPerTonne(param);
  if (perTonne === null) return null;

  const native = (param.copper_currency ?? "USD").toUpperCase() as CopperCurrency;
  if (native === target) return formatCopper(perTonne);

  const fxRates = fx ?? { eurRmb: "", eurUsd: "" };
  const rmb = toRmb(perTonne, native, fxRates);
  if (rmb === null) return null;
  return copperRmbToDraft(String(rmb), target, fxRates);
}

export function copperHistoryForMarket(
  params: MarketParameter[],
  market: CopperMarket,
): MarketParameter[] {
  return params
    .filter((p) => p.parameter_type === "copper_price" && p.copper_market === market)
    .sort((a, b) => (b.valid_from ?? "").localeCompare(a.valid_from ?? ""));
}

export function normalizeCopperCurrency(value: unknown): CopperCurrency {
  if (value === "USD" || value === "EUR" || value === "RMB") return value;
  return "RMB";
}
