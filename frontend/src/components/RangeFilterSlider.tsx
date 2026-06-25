"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";

interface RangeFilterSliderProps {
  label: string;
  min: number;
  max: number;
  step: number;
  /** Single-thumb mode (min only). */
  dual?: boolean;
  minValue: number | null;
  maxValue?: number | null;
  onChange: (min: number | null, max?: number | null) => void;
  formatValue?: (n: number) => string;
  unit?: string;
  className?: string;
}

const defaultFormat = (n: number) => n.toLocaleString("fr-FR");

export function RangeFilterSlider({
  label,
  min,
  max,
  step,
  dual = false,
  minValue,
  maxValue = null,
  onChange,
  formatValue = defaultFormat,
  unit,
  className,
}: RangeFilterSliderProps) {
  const effectiveMin = minValue ?? min;
  const effectiveMax = maxValue ?? max;

  const isActive = dual
    ? effectiveMin > min || effectiveMax < max
    : effectiveMin > min;

  const sliderValue = dual ? [effectiveMin, effectiveMax] : [effectiveMin];

  const summary = useMemo(() => {
    const fmt = (n: number) => `${formatValue(n)}${unit ? ` ${unit}` : ""}`;
    if (!isActive) return "Toutes les valeurs";
    if (dual) {
      if (effectiveMin > min && effectiveMax < max) {
        return `${fmt(effectiveMin)} — ${fmt(effectiveMax)}`;
      }
      if (effectiveMin > min) return `≥ ${fmt(effectiveMin)}`;
      return `≤ ${fmt(effectiveMax)}`;
    }
    return `≥ ${fmt(effectiveMin)}`;
  }, [dual, effectiveMin, effectiveMax, formatValue, isActive, min, max, unit]);

  const handleSlider = (val: number | readonly number[]) => {
    const values = Array.isArray(val) ? [...val] : [val];
    if (dual) {
      const [lo, hi] = values as [number, number];
      onChange(
        lo > min ? lo : null,
        hi < max ? hi : null,
      );
    } else {
      const v = values[0] ?? min;
      onChange(v > min ? v : null);
    }
  };

  const reset = () => onChange(null, dual ? null : undefined);

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-foreground">{label}</p>
          <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">{summary}</p>
        </div>
        {isActive && (
          <Button type="button" variant="ghost" size="xs" onClick={reset}>
            Réinitialiser
          </Button>
        )}
      </div>

      <Slider
        min={min}
        max={max}
        step={step}
        value={sliderValue}
        onValueChange={handleSlider}
        aria-label={label}
      />

      <div className="flex justify-between text-[11px] tabular-nums text-muted-foreground">
        <span>
          {formatValue(min)}
          {unit ? ` ${unit}` : ""}
        </span>
        <span>
          {formatValue(max)}
          {unit ? ` ${unit}` : ""}
        </span>
      </div>
    </div>
  );
}
