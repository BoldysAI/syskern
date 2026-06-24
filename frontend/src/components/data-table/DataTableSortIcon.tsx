"use client";

import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import type { SortDir } from "./types";

export function DataTableSortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronsUpDown size={13} className="shrink-0 text-muted-foreground" />;
  return dir === "asc" ? (
    <ChevronUp size={13} className="shrink-0 text-primary" />
  ) : (
    <ChevronDown size={13} className="shrink-0 text-primary" />
  );
}
