"use client";

import { MagnifyingGlass, X } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  id?: string;
}

export function SearchInput({
  value,
  onChange,
  placeholder = "Rechercher…",
  className,
  inputClassName,
  id,
}: SearchInputProps) {
  return (
    <div className={cn("relative", className)}>
      <MagnifyingGlass
        size={16}
        weight="duotone"
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        id={id}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn("pl-9 pr-9", inputClassName)}
      />
      {value.length > 0 && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="absolute right-1 top-1/2 -translate-y-1/2"
          onClick={() => onChange("")}
          aria-label="Effacer la recherche"
        >
          <X size={14} />
        </Button>
      )}
    </div>
  );
}
