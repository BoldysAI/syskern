"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";

const ALL_VALUE = "__all__";

interface FilterSelectProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  options: { value: string; label: string }[];
  className?: string;
  disabled?: boolean;
}

export function FilterSelect({
  value,
  onChange,
  placeholder,
  options,
  className,
  disabled,
}: FilterSelectProps) {
  const selectValue = value || ALL_VALUE;

  const displayLabel = useMemo(() => {
    if (selectValue === ALL_VALUE) return placeholder;
    return options.find((o) => o.value === selectValue)?.label ?? selectValue;
  }, [selectValue, options, placeholder]);

  return (
    <Select
      value={selectValue}
      onValueChange={(v) => onChange(v === ALL_VALUE ? "" : String(v))}
      disabled={disabled}
    >
      <SelectTrigger className={cn("w-full min-w-[10rem] bg-background", className)}>
        <span
          className={cn(
            "flex flex-1 truncate text-left",
            selectValue === ALL_VALUE && "text-muted-foreground",
          )}
        >
          {displayLabel}
        </span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_VALUE}>{placeholder}</SelectItem>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
