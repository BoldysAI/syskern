"use client";

import { cn } from "@/lib/utils";

interface Props {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  /** Optional title above the slider (without the percentage). */
  title?: string;
  className?: string;
}

/**
 * Mix stock/achat — `value` is the stock (PAMP) weight in PR (0 = 100% achat, 100 = 100% stock).
 */
export function StockPurchaseMixSlider({
  value,
  onChange,
  disabled,
  title = "Mix stock / achat",
  className,
}: Props) {
  const stockPct = value;
  const purchasePct = 100 - value;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-xs font-semibold text-slate-600">{title}</label>
        <span className="text-xs text-slate-500">
          <span className="font-semibold text-slate-700">{purchasePct}% achat</span>
          {" · "}
          <span className="font-semibold text-accent-foreground">{stockPct}% stock</span>
        </span>
      </div>

      {/* Visual blend bar */}
      <div className="relative h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className="absolute inset-y-0 left-0 bg-slate-400/70 transition-[width] duration-75"
          style={{ width: `${purchasePct}%` }}
          aria-hidden
        />
        <div
          className="absolute inset-y-0 right-0 bg-primary/80 transition-[width] duration-75"
          style={{ width: `${stockPct}%` }}
          aria-hidden
        />
      </div>

      <input
        type="range"
        min={0}
        max={100}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        aria-valuetext={`${purchasePct} pour cent achat, ${stockPct} pour cent stock`}
        className="w-full accent-primary"
      />

      <div className="flex justify-between text-xs font-medium">
        <span className="flex flex-col items-start text-slate-600">
          <span>Achat (PA)</span>
          <span className="font-normal text-slate-400">100% achat à gauche</span>
        </span>
        <span className="flex flex-col items-end text-accent-foreground">
          <span>Stock (PAMP)</span>
          <span className="font-normal text-slate-400">100% stock à droite</span>
        </span>
      </div>

      <p className="text-[11px] leading-snug text-slate-400">
        Le PR mélange le prix d&apos;achat net (PA) et le PAMP prévisionnel selon cette répartition.
      </p>
    </div>
  );
}
