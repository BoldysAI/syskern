"use client";

import { useState } from "react";
import { CaretDown, DownloadSimple, Warning, X } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface Props {
  skus: string[];
  onClear: () => void;
}

export function NotFoundSkuBanner({ skus, onClear }: Props) {
  const [open, setOpen] = useState(false);

  if (skus.length === 0) return null;

  const downloadReport = () => {
    const csv = "sku_code\n" + skus.map((s) => `"${s.replace(/"/g, '""')}"`).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sku_non_trouves.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="overflow-hidden rounded-lg border border-destructive/30 bg-destructive/10">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-destructive/5"
        aria-expanded={open}
      >
        <Warning size={18} weight="fill" className="shrink-0 text-destructive" />
        <span className="flex-1 text-sm font-semibold text-destructive">
          {skus.length} SKU non trouvé{skus.length > 1 ? "s" : ""} lors de l&apos;import
        </span>
        <CaretDown
          size={16}
          className={cn("shrink-0 text-destructive transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="border-t border-destructive/20 bg-card/80 px-4 py-3">
          <ul className="max-h-48 space-y-1 overflow-y-auto">
            {skus.map((sku) => (
              <li key={sku} className="truncate font-mono text-sm text-destructive">
                {sku}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={downloadReport}>
              <DownloadSimple size={14} />
              Télécharger le rapport
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={onClear}
            >
              <X size={14} />
              Vider la liste
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
