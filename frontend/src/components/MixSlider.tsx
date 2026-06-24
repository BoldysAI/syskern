"use client";

import { cn } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";

interface MixSliderProps {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  title?: string;
  className?: string;
}

/** Mix stock/achat — `value` = poids stock (PAMP) dans le PR (0 = 100% achat, 100 = 100% stock). */
export function MixSlider({
  value,
  onChange,
  disabled,
  title = "Mix stock / achat",
  className,
}: MixSliderProps) {
  const stockPct = value;
  const purchasePct = 100 - value;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-xs font-semibold text-foreground">{title}</label>
        <span className="text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">{purchasePct}% achat</span>
          {" · "}
          <span className="font-semibold text-primary">{stockPct}% stock</span>
        </span>
      </div>

      <div className="relative h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="absolute inset-y-0 left-0 bg-muted-foreground/40 transition-[width] duration-150"
          style={{ width: `${purchasePct}%` }}
          aria-hidden
        />
        <div
          className="absolute inset-y-0 right-0 bg-primary/80 transition-[width] duration-150"
          style={{ width: `${stockPct}%` }}
          aria-hidden
        />
      </div>

      <Slider
        min={0}
        max={100}
        step={1}
        value={[value]}
        disabled={disabled}
        onValueChange={(val) => onChange(Array.isArray(val) ? (val[0] ?? 0) : val)}
        aria-valuetext={`${purchasePct} pour cent achat, ${stockPct} pour cent stock`}
      />

      <div className="flex justify-between text-xs font-medium">
        <span className="flex flex-col items-start text-muted-foreground">
          <span>Achat (PA)</span>
          <span className="font-normal text-muted-foreground/80">100% achat à gauche</span>
        </span>
        <span className="flex flex-col items-end text-primary">
          <span>Stock (PAMP)</span>
          <span className="font-normal text-muted-foreground/80">100% stock à droite</span>
        </span>
      </div>
    </div>
  );
}
