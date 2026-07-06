"use client";

import { cn } from "@/lib/utils";
import { FilterCheckboxGroup } from "@/components/FilterCheckboxGroup";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RangeFilterSlider } from "@/components/RangeFilterSlider";
import type { AttributeRegistry } from "@/lib/api";
import { boundsToSliderConfig } from "@/app/catalog/_components/slider-bounds";

function localize(label: Record<string, string>): string {
  return label.fr || label.en || label.es || Object.values(label)[0] || "";
}

interface CatalogAttributeFilterProps {
  attribute: AttributeRegistry;
  value: string | string[] | undefined;
  onChange: (v: string | string[]) => void;
  numberBounds?: { min: number; max: number };
}
export function CatalogAttributeFilter({
  attribute,
  value,
  onChange,
  numberBounds,
}: CatalogAttributeFilterProps) {
  const label = localize(attribute.label);

  if (attribute.data_type === "boolean") {
    const tri = (value as string) ?? "";
    return (
      <div className="rounded-xl border border-border bg-card/40 p-3">
        <p className="mb-2 text-xs font-semibold text-foreground">{label}</p>
        <div className="flex gap-1.5">
          {[
            { v: "", l: "Tous" },
            { v: "true", l: "Oui" },
            { v: "false", l: "Non" },
          ].map((opt) => (
            <button
              key={opt.v || "all"}
              type="button"
              onClick={() => onChange(opt.v)}
              className={cn(
                "flex-1 rounded-lg border py-2 text-xs font-medium transition-colors",
                tri === opt.v
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-background text-muted-foreground hover:border-border hover:bg-muted/50",
              )}
            >
              {opt.l}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (attribute.data_type === "select" || attribute.data_type === "multiselect") {
    const selected = Array.isArray(value) ? value : value ? [value as string] : [];
    const opts = (attribute.options ?? []).map((o) => ({
      value: o.value,
      label: localize(o.label),
    }));

    return (
      <div className="rounded-xl border border-border bg-card/40 overflow-hidden">
        <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-muted/30 px-3 py-2">
          <span className="text-xs font-semibold text-foreground">{label}</span>
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange("")}
              className="text-[11px] font-semibold text-primary hover:text-primary/80"
            >
              Effacer
            </button>
          )}
        </div>
        <div className="p-2.5">
          <FilterCheckboxGroup
            options={opts}
            selected={selected}
            onChange={(next) =>
              onChange(
                attribute.data_type === "select"
                  ? next.length === 1
                    ? next[0]
                    : next.length
                      ? next
                      : ""
                  : next,
              )
            }
            searchable={opts.length > 5}
            maxHeight="max-h-36"
          />
        </div>
      </div>
    );
  }

  if (attribute.data_type === "date") {
    return (
      <div className="rounded-xl border border-border bg-card/40 p-3">
        <Label className="mb-2 text-xs font-semibold">{label}</Label>
        <Input
          type="date"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className="h-9"
        />
      </div>
    );
  }

  if (attribute.data_type === "number") {
    const num = value != null && value !== "" ? Number(value) : null;
    const fallbackMax = Math.max(100, numberBounds?.max ?? 0, num ?? 0);
    const slider = boundsToSliderConfig(numberBounds ?? null, fallbackMax);
    return (
      <div className="rounded-xl border border-border bg-card/40 p-3">
        <RangeFilterSlider
          label={`${label}${attribute.unit ? ` (${attribute.unit})` : ""}`}
          min={slider.min}
          max={slider.max}
          step={slider.step}
          minValue={
            num != null && !Number.isNaN(num) ? Math.min(Math.max(num, slider.min), slider.max) : null
          }
          onChange={(v) => onChange(v != null ? String(v) : "")}
          unit={attribute.unit}
        />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card/40 p-3">
      <Label className="mb-2 text-xs font-semibold">{label}</Label>
      <Input
        type="text"
        value={(value as string) ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="h-9"
        placeholder="Contient…"
      />
    </div>
  );
}
