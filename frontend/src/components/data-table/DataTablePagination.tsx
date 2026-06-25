"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type PageItem = number | "ellipsis";

/** Build a Google-style page number list with ellipses. */
export function buildPageItems(current: number, total: number): PageItem[] {
  if (total <= 1) return [];
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const items: PageItem[] = [];
  const siblings = 1;
  const left = Math.max(2, current - siblings);
  const right = Math.min(total - 1, current + siblings);

  items.push(1);
  if (left > 2) items.push("ellipsis");
  for (let p = left; p <= right; p += 1) items.push(p);
  if (right < total - 1) items.push("ellipsis");
  items.push(total);
  return items;
}

export interface DataTablePaginationProps {
  page: number;
  totalPages: number;
  totalCount: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  itemLabel?: string;
  jumpInputId?: string;
  ariaLabel?: string;
}

export function DataTablePagination({
  page,
  totalPages,
  totalCount,
  pageSize,
  onPageChange,
  itemLabel = "élément",
  jumpInputId = "data-table-page-jump",
  ariaLabel = "Pagination",
}: DataTablePaginationProps) {
  const [jumpValue, setJumpValue] = useState("");
  const items = buildPageItems(page, totalPages);
  const from = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalCount);

  const goToPage = (target: number) => {
    const clamped = Math.max(1, Math.min(totalPages, target));
    onPageChange(clamped);
    setJumpValue("");
  };

  const handleJumpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = parseInt(jumpValue, 10);
    if (!Number.isNaN(n)) goToPage(n);
  };

  if (totalPages <= 1) return null;

  const plural = totalCount !== 1 ? "s" : "";

  return (
    <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-4 border-t border-border bg-card px-6 py-3">
      <span className="text-sm tabular-nums text-muted-foreground">
        {from}–{to} sur {totalCount} {itemLabel}
        {plural}
      </span>

      <nav className="flex items-center gap-1" aria-label={ariaLabel}>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          disabled={page <= 1}
          onClick={() => goToPage(page - 1)}
          aria-label="Page précédente"
        >
          <ChevronLeft size={18} />
        </Button>

        {items.map((item, idx) =>
          item === "ellipsis" ? (
            <span
              key={`ellipsis-${idx}`}
              className="flex h-9 w-9 items-center justify-center text-sm text-muted-foreground"
              aria-hidden
            >
              …
            </span>
          ) : (
            <Button
              key={item}
              type="button"
              variant={item === page ? "default" : "outline"}
              size="sm"
              onClick={() => goToPage(item)}
              aria-current={item === page ? "page" : undefined}
              className={cn("min-w-9 tabular-nums", item === page && "shadow-sm")}
            >
              {item}
            </Button>
          )
        )}

        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          disabled={page >= totalPages}
          onClick={() => goToPage(page + 1)}
          aria-label="Page suivante"
        >
          <ChevronRight size={18} />
        </Button>
      </nav>

      <form onSubmit={handleJumpSubmit} className="flex items-center gap-2">
        <label htmlFor={jumpInputId} className="whitespace-nowrap text-sm text-muted-foreground">
          Aller à
        </label>
        <Input
          id={jumpInputId}
          type="number"
          min={1}
          max={totalPages}
          value={jumpValue}
          onChange={(e) => setJumpValue(e.target.value)}
          placeholder={String(page)}
          className="h-8 w-16 text-center tabular-nums"
        />
        <span className="text-sm text-muted-foreground">/ {totalPages}</span>
      </form>
    </div>
  );
}
