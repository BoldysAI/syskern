"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface OptionSelectOption {
  value: string;
  label: string;
}

interface OptionSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: readonly OptionSelectOption[] | OptionSelectOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  size?: "sm" | "default";
}

/**
 * Select avec libellé affiché (Base UI n'infère pas le texte depuis SelectItem).
 * Même pattern que `catalog/new` SelectField et `FilterSelect`.
 */
export function OptionSelect({
  value,
  onValueChange,
  options,
  placeholder = "Sélectionner…",
  className,
  disabled,
  size = "default",
}: OptionSelectProps) {
  const selectedLabel = useMemo(
    () => options.find((o) => o.value === value)?.label,
    [options, value],
  );

  return (
    <Select
      value={value || null}
      onValueChange={(v) => v != null && onValueChange(String(v))}
      disabled={disabled}
    >
      <SelectTrigger size={size} className={cn("w-full min-w-0 bg-background", className)}>
        <SelectValue placeholder={placeholder}>{selectedLabel}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
