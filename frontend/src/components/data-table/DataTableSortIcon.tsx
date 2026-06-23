"use client";

import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import type { SortDir } from "./types";

export function DataTableSortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronsUpDown size={13} className="shrink-0 text-slate-400" />;
  return dir === "asc" ? (
    <ChevronUp size={13} className="shrink-0 text-orange-500" />
  ) : (
    <ChevronDown size={13} className="shrink-0 text-orange-500" />
  );
}
