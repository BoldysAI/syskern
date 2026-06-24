"use client";

import { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { CaretDown, CircleNotch, Download } from "@phosphor-icons/react";
import { exportProducts, type CatalogFilters } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );

  const runExport = async () => {
    setBusy(true);
    setError(null);
    try {
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

  return (
    <div className="flex items-center">
      <div className="inline-flex items-stretch">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={runExport}
          disabled={disabled || busy}
          className="rounded-r-none border-r-0"
          title={hasSelection ? "Exporter la sélection" : "Exporter le résultat filtré"}
        >
          {busy ? <CircleNotch size={15} className="animate-spin" /> : <Download size={15} />}
          <span className="hidden sm:inline">
            {busy ? "Export…" : hasSelection ? `Exporter (${selectedIds!.length})` : "Exporter"}
          </span>
        </Button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild disabled={disabled || busy}>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              className="rounded-l-none"
              title="Choisir les colonnes"
            >
              <CaretDown size={15} />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={4}
              className="z-50 max-h-80 w-56 overflow-y-auto rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-md"
            >
              <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Colonnes
              </div>
              {EXPORT_COLUMNS.map((col) => (
                <DropdownMenu.CheckboxItem
                  key={col.key}
                  checked={columns.includes(col.key)}
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={() => toggle(col.key)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none",
                    "data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
                  )}
                >
                  <Checkbox checked={columns.includes(col.key)} tabIndex={-1} className="pointer-events-none" />
                  {col.label}
                </DropdownMenu.CheckboxItem>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
      {error && <span className="ml-2 text-xs text-destructive">{error}</span>}
    </div>
  );
}
