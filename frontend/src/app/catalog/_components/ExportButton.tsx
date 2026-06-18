"use client";

import { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Download, Loader2 } from "lucide-react";
import { exportProducts, type CatalogFilters } from "@/lib/api";
import { cn } from "@/lib/utils";
import { DEFAULT_EXPORT_COLUMNS, EXPORT_COLUMNS } from "./columns";

interface ExportButtonProps {
  filters: CatalogFilters;
  /** When set, export only this selection instead of the full filtered set. */
  selectedIds?: string[];
  disabled?: boolean;
}

export function ExportButton({ filters, selectedIds, disabled }: ExportButtonProps) {
  const [columns, setColumns] = useState<string[]>(DEFAULT_EXPORT_COLUMNS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasSelection = !!selectedIds?.length;

  const toggle = (key: string) =>
    setColumns((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );

  const runExport = async () => {
    setBusy(true);
    setError(null);
    try {
      // Preserve registry order for the chosen columns.
      const ordered = EXPORT_COLUMNS.filter((c) => columns.includes(c.key)).map((c) => c.key);
      await exportProducts({
        filters,
        columns: ordered.length ? ordered : DEFAULT_EXPORT_COLUMNS,
        ids: hasSelection ? selectedIds : undefined,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export échoué");
    } finally {
      setBusy(false);
    }
  };

  const splitBtn =
    "inline-flex items-center justify-center h-9 text-sm bg-white border border-[#E2E8F0] hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <div className="flex items-center">
      <div className="inline-flex items-stretch">
        <button
          type="button"
          onClick={runExport}
          disabled={disabled || busy}
          className={cn(
            splitBtn,
            "gap-2 px-4 font-medium text-slate-600 rounded-l-lg border-r-0"
          )}
          title={hasSelection ? "Exporter la sélection" : "Exporter le résultat filtré"}
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
          <span className="hidden sm:inline">
            {busy ? "Export…" : hasSelection ? `Exporter (${selectedIds!.length})` : "Exporter"}
          </span>
        </button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            disabled={disabled || busy}
            className={cn(splitBtn, "w-9 px-0 text-slate-600 rounded-r-lg")}
            title="Choisir les colonnes"
          >
            <ChevronDown size={15} />
          </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={4}
            className="z-50 max-h-80 w-56 overflow-y-auto rounded-lg border border-[#E2E8F0] bg-white p-2 shadow-lg"
          >
            <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Colonnes
            </div>
            {EXPORT_COLUMNS.map((col) => (
              <DropdownMenu.CheckboxItem
                key={col.key}
                checked={columns.includes(col.key)}
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={() => toggle(col.key)}
                className={cn(
                  "flex items-center gap-2 px-2 py-1.5 text-sm text-slate-700 rounded cursor-pointer outline-none",
                  "data-[highlighted]:bg-[#FFF3E0]"
                )}
              >
                <input
                  type="checkbox"
                  readOnly
                  checked={columns.includes(col.key)}
                  className="w-4 h-4 rounded border-slate-300 accent-[#E07200]"
                />
                {col.label}
              </DropdownMenu.CheckboxItem>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      </div>
      {error && <span className="ml-2 text-xs text-red-600">{error}</span>}
    </div>
  );
}
