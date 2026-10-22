"use client";

import { useUiTranslate } from "@/lib/use-ui-translate";
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
  title,
  className,
}: MixSliderProps) {
  const t = useUiTranslate();
  const stockPct = value;
  const purchasePct = 100 - value;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-xs font-semibold text-foreground">{title ?? t("common.mixTitle")}</label>
        <span className="text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">
            {t("common.mixPurchasePct", { pct: purchasePct })}
          </span>
          {" · "}
          <span className="font-semibold text-primary">
            {t("common.mixStockPct", { pct: stockPct })}
          </span>
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
        aria-valuetext={t("common.mixAria", { purchase: purchasePct, stock: stockPct })}
      />

      <div className="flex justify-between text-xs font-medium">
        <span className="flex flex-col items-start text-muted-foreground">
          <span>{t("common.mixPurchase")}</span>
          <span className="font-normal text-muted-foreground/80">{t("common.mixPurchaseLeft")}</span>
        </span>
        <span className="flex flex-col items-end text-primary">
          <span>{t("common.mixStock")}</span>
          <span className="font-normal text-muted-foreground/80">{t("common.mixStockRight")}</span>
        </span>
      </div>
    </div>
  );
}
