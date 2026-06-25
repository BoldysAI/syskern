"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface FilterCheckboxGroupProps {
  options: { value: string; label: string; count?: number }[];
  selected: string[];
  onChange: (next: string[]) => void;
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Tailwind max-height class for the scroll area. */
  maxHeight?: string;
  sortSelectedFirst?: boolean;
  /** Prefix for checkbox ids — avoids collisions across filter sections. */
  idPrefix?: string;
  className?: string;
}

function optionDomId(prefix: string, value: string): string {
  return `${prefix}-${encodeURIComponent(value)}`;
}

export function FilterCheckboxGroup({
  options,
  selected,
  onChange,
  searchable,
  searchPlaceholder = "Rechercher…",
  maxHeight = "max-h-48",
  sortSelectedFirst = false,
  idPrefix = "filter",
  className,
}: FilterCheckboxGroupProps) {
  const [query, setQuery] = useState("");
  const selectedRef = useRef(selected);
  useLayoutEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  const filtered = useMemo(() => {
    let list = options;
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter((o) => o.label.toLowerCase().includes(q));
    }
    if (sortSelectedFirst) {
      const sel = new Set(selected);
      list = [...list].sort((a, b) => {
        const as = sel.has(a.value);
        const bs = sel.has(b.value);
        if (as !== bs) return as ? -1 : 1;
        return a.label.localeCompare(b.label, "fr");
      });
    }
    return list;
  }, [options, query, selected, sortSelectedFirst]);

  const toggle = (value: string) => {
    const current = selectedRef.current;
    onChange(
      current.includes(value) ? current.filter((v) => v !== value) : [...current, value],
    );
  };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {searchable && options.length > 4 && (
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchPlaceholder}
          className="h-8"
        />
      )}
      <div className={cn("overflow-y-auto overscroll-contain", maxHeight)}>
        <ul className="space-y-0.5 pr-1">
          {filtered.length === 0 ? (
            <li className="px-2 py-4 text-center text-xs text-muted-foreground">Aucun résultat</li>
          ) : (
            filtered.map((opt) => {
              const id = optionDomId(idPrefix, opt.value);
              const checked = selected.includes(opt.value);
              return (
                <li key={opt.value}>
                  <Label
                    htmlFor={id}
                    className={cn(
                      "flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-sm font-normal transition-colors",
                      checked
                        ? "bg-primary/8 hover:bg-primary/10"
                        : "hover:bg-muted/60",
                    )}
                  >
                    <Checkbox id={id} checked={checked} onCheckedChange={() => toggle(opt.value)} />
                    <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                    {opt.count != null && (
                      <span className="text-xs tabular-nums text-muted-foreground">{opt.count}</span>
                    )}
                  </Label>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
