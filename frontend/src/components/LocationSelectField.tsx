"use client";

import { useEffect, useState } from "react";
import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SALE_INCOTERM_LOCATION_NONE,
  SALE_INCOTERM_LOCATION_OTHER,
  SALE_INCOTERM_LOCATIONS,
  isPresetSaleIncotermLocation,
  resolveSaleIncotermLocationUi,
} from "@/lib/incoterms";

const selectItemCls =
  "flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-md cursor-pointer select-none outline-none data-[highlighted]:bg-[#FFF3E0] data-[highlighted]:text-[#C56400]";

interface Props {
  value: string;
  onChange: (location: string) => void;
  disabled?: boolean;
  /** Accessible name (e.g. « Origine », « Destination »). */
  ariaLabel: string;
  /** Trigger label when no location is set (e.g. « De », « À »). */
  emptyLabel?: string;
  inputClassName?: string;
  customInputClassName?: string;
}

export function LocationSelectField({
  value,
  onChange,
  disabled,
  ariaLabel,
  emptyLabel = "Choisir un lieu…",
  inputClassName,
  customInputClassName,
}: Props) {
  const triggerCls =
    inputClassName ??
    "w-full px-3 py-2 text-sm border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#E07200]/30 focus:border-[#E07200]";
  const customCls = customInputClassName ?? triggerCls;

  const [otherExplicit, setOtherExplicit] = useState(() => {
    const t = value.trim();
    return Boolean(t && !isPresetSaleIncotermLocation(t));
  });

  useEffect(() => {
    const t = value.trim();
    if (!t) return;
    setOtherExplicit(!isPresetSaleIncotermLocation(t));
  }, [value]);

  const {
    selectValue: locationSelect,
    showCustom: showCustomLocation,
    displayLabel: locationLabel,
  } = resolveSaleIncotermLocationUi(value, otherExplicit, emptyLabel);

  const handleSelect = (selected: string) => {
    if (selected === SALE_INCOTERM_LOCATION_NONE) {
      setOtherExplicit(false);
      onChange("");
      return;
    }
    if (selected === SALE_INCOTERM_LOCATION_OTHER) {
      setOtherExplicit(true);
      if (isPresetSaleIncotermLocation(value)) {
        onChange("");
      }
      return;
    }
    setOtherExplicit(false);
    onChange(selected);
  };

  return (
    <div className="flex flex-col gap-1">
      <Select.Root value={locationSelect} onValueChange={handleSelect} disabled={disabled}>
        <Select.Trigger
          aria-label={`${ariaLabel} : ${locationLabel}`}
          className={cn(
            triggerCls,
            "flex items-center justify-between gap-2 text-left disabled:opacity-50"
          )}
        >
          <span
            className={cn(
              "flex-1 truncate",
              locationSelect === SALE_INCOTERM_LOCATION_NONE && "text-slate-400"
            )}
          >
            {locationLabel}
          </span>
          <Select.Icon>
            <ChevronDown size={15} className="text-slate-400 shrink-0" />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content
            position="popper"
            sideOffset={4}
            className="z-50 max-h-64 min-w-[var(--radix-select-trigger-width)] bg-white border border-[#E2E8F0] rounded-lg shadow-lg overflow-hidden"
          >
            <Select.Viewport className="p-1">
              <Select.Item value={SALE_INCOTERM_LOCATION_NONE} className={selectItemCls}>
                <Select.ItemText>— Non renseigné —</Select.ItemText>
                <Select.ItemIndicator>
                  <Check size={14} className="text-[#E07200]" />
                </Select.ItemIndicator>
              </Select.Item>
              {SALE_INCOTERM_LOCATIONS.map((place) => (
                <Select.Item key={place} value={place} className={selectItemCls}>
                  <Select.ItemText>{place}</Select.ItemText>
                  <Select.ItemIndicator>
                    <Check size={14} className="text-[#E07200]" />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
              <Select.Item value={SALE_INCOTERM_LOCATION_OTHER} className={selectItemCls}>
                <Select.ItemText>Autre…</Select.ItemText>
                <Select.ItemIndicator>
                  <Check size={14} className="text-[#E07200]" />
                </Select.ItemIndicator>
              </Select.Item>
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
      {showCustomLocation && (
        <input
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className={customCls}
          placeholder="Précisez le lieu…"
          aria-label={`${ariaLabel} (saisie libre)`}
        />
      )}
    </div>
  );
}
