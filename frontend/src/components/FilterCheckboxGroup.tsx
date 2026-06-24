"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";

interface FilterCheckboxGroupProps {
  options: { value: string; label: string; count?: number }[];
  selected: string[];
  onChange: (next: string[]) => void;
  searchable?: boolean;
  searchPlaceholder?: string;
  className?: string;
}

export function FilterCheckboxGroup({
  options,
  selected,
  onChange,
  searchable,
  searchPlaceholder = "Rechercher…",
  className,
}: FilterCheckboxGroupProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!query.trim()) return options;
    const q = query.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  const toggle = (value: string) => {
    onChange(
      selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value],
    );
  };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {searchable && (
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchPlaceholder}
          className="h-8"
        />
      )}
      <ScrollArea className="max-h-48">
        <ul className="space-y-1 pr-2">
          {filtered.map((opt) => {
            const id = `filter-${opt.value}`;
            const checked = selected.includes(opt.value);
            return (
              <li key={opt.value}>
                <Label
                  htmlFor={id}
                  className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-sm font-normal hover:bg-muted/60"
                >
                  <Checkbox id={id} checked={checked} onCheckedChange={() => toggle(opt.value)} />
                  <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                  {opt.count != null && (
                    <span className="text-xs tabular-nums text-muted-foreground">{opt.count}</span>
                  )}
                </Label>
              </li>
            );
          })}
        </ul>
      </ScrollArea>
    </div>
  );
}
