"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

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

interface CatalogPaginationProps {
  page: number;
  totalPages: number;
  totalCount: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

export function CatalogPagination({
  page,
  totalPages,
  totalCount,
  pageSize,
  onPageChange,
}: CatalogPaginationProps) {
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

  return (
    <div className="flex-shrink-0 flex flex-wrap items-center justify-between gap-4 px-6 py-3 bg-white border-t border-[#E2E8F0]">
      <span className="text-sm text-slate-500 tabular-nums">
        {from}–{to} sur {totalCount} produit{totalCount !== 1 ? "s" : ""}
      </span>

      <nav className="flex items-center gap-1" aria-label="Pagination du catalogue">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => goToPage(page - 1)}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          aria-label="Page précédente"
        >
          <ChevronLeft size={18} />
        </button>

        {items.map((item, idx) =>
          item === "ellipsis" ? (
            <span
              key={`ellipsis-${idx}`}
              className="flex h-9 w-9 items-center justify-center text-sm text-slate-400"
              aria-hidden
            >
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              onClick={() => goToPage(item)}
              aria-current={item === page ? "page" : undefined}
              className={cn(
                "min-w-[2.25rem] h-9 px-2 text-sm font-medium rounded-lg transition-colors tabular-nums",
                item === page
                  ? "bg-orange-500 text-white shadow-sm"
                  : "border border-slate-200 text-slate-700 hover:bg-slate-50"
              )}
            >
              {item}
            </button>
          )
        )}

        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => goToPage(page + 1)}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          aria-label="Page suivante"
        >
          <ChevronRight size={18} />
        </button>
      </nav>

      <form onSubmit={handleJumpSubmit} className="flex items-center gap-2">
        <label htmlFor="catalog-page-jump" className="text-sm text-slate-500 whitespace-nowrap">
          Aller à
        </label>
        <input
          id="catalog-page-jump"
          type="number"
          min={1}
          max={totalPages}
          value={jumpValue}
          onChange={(e) => setJumpValue(e.target.value)}
          placeholder={String(page)}
          className="w-16 px-2 py-1.5 text-sm text-center border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#E07200]/30 focus:border-[#E07200] tabular-nums"
        />
        <span className="text-sm text-slate-400">/ {totalPages}</span>
      </form>
    </div>
  );
}
