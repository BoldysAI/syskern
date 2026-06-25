"use client";

import { useState } from "react";
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
  "flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-md cursor-pointer select-none outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground";

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
    "w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary";
  const customCls = customInputClassName ?? triggerCls;

  const [otherSelected, setOtherSelected] = useState(false);
  const trimmed = value.trim();
  const valueImpliesOther = Boolean(trimmed && !isPresetSaleIncotermLocation(trimmed));
  const otherExplicit = otherSelected || valueImpliesOther;

  const {
    selectValue: locationSelect,
    showCustom: showCustomLocation,
    displayLabel: locationLabel,
  } = resolveSaleIncotermLocationUi(value, otherExplicit, emptyLabel);

  const handleSelect = (selected: string) => {
    if (selected === SALE_INCOTERM_LOCATION_NONE) {
      setOtherSelected(false);
      onChange("");
      return;
    }
    if (selected === SALE_INCOTERM_LOCATION_OTHER) {
      setOtherSelected(true);
      if (isPresetSaleIncotermLocation(value)) {
        onChange("");
      }
      return;
    }
    setOtherSelected(false);
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
              locationSelect === SALE_INCOTERM_LOCATION_NONE && "text-muted-foreground"
            )}
          >
            {locationLabel}
          </span>
          <Select.Icon>
            <ChevronDown size={15} className="text-muted-foreground shrink-0" />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content
            position="popper"
            sideOffset={4}
            className="z-50 max-h-64 min-w-[var(--radix-select-trigger-width)] bg-popover border border-border rounded-lg shadow-lg overflow-hidden"
          >
            <Select.Viewport className="p-1">
              <Select.Item value={SALE_INCOTERM_LOCATION_NONE} className={selectItemCls}>
                <Select.ItemText>— Non renseigné —</Select.ItemText>
                <Select.ItemIndicator>
                  <Check size={14} className="text-warm" />
                </Select.ItemIndicator>
              </Select.Item>
              {SALE_INCOTERM_LOCATIONS.map((place) => (
                <Select.Item key={place} value={place} className={selectItemCls}>
                  <Select.ItemText>{place}</Select.ItemText>
                  <Select.ItemIndicator>
                    <Check size={14} className="text-warm" />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
              <Select.Item value={SALE_INCOTERM_LOCATION_OTHER} className={selectItemCls}>
                <Select.ItemText>Autre…</Select.ItemText>
                <Select.ItemIndicator>
                  <Check size={14} className="text-warm" />
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
