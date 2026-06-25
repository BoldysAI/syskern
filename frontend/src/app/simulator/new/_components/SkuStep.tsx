"use client";

import { useMemo, useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { DownloadSimple, Table, TreeStructure, ListChecks } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { CatalogueSelectionPanel } from "./CatalogueSelectionPanel";
import { HierarchyFilterPanel } from "./HierarchyFilterPanel";
import { ImportFilePanel } from "./ImportFilePanel";
import { SelectedSkuList } from "./SelectedSkuList";
import type { SelectedSku } from "./wizard-draft";

interface Props {
  selectedSkus: SelectedSku[];
  onChange: (skus: SelectedSku[]) => void;
}

const TAB_TRIGGER =
  "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors data-[state=active]:border-primary data-[state=active]:text-accent-foreground data-[state=inactive]:border-transparent data-[state=inactive]:text-muted-foreground hover:text-foreground";

export function SkuStep({ selectedSkus, onChange }: Props) {
  const [notFound, setNotFound] = useState<string[]>([]);

  const selectedIds = useMemo(() => new Set(selectedSkus.map((s) => s.id)), [selectedSkus]);

  /** Merge new SKU into the cumulative list, deduplicating by id. */
  const handleAdd = (skus: SelectedSku[]) => {
    const byId = new Map(selectedSkus.map((s) => [s.id, s]));
    for (const s of skus) byId.set(s.id, s);
    onChange([...byId.values()]);
  };

  const handleRemove = (id: string) => onChange(selectedSkus.filter((s) => s.id !== id));
  const handleClear = () => onChange([]);

  const mergeNotFound = (skus: string[]) => {
    setNotFound((prev) => [...new Set([...prev, ...skus])]);
  };

  const downloadReport = () => {
    const csv = "sku_code\n" + notFound.map((s) => `"${s.replace(/"/g, '""')}"`).join("\n");
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
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">
      <div className="flex flex-col gap-5 min-w-0">
        <Tabs.Root defaultValue="catalogue">
          <Tabs.List className="flex items-center gap-1 border-b border-border">
            <Tabs.Trigger value="catalogue" className={TAB_TRIGGER}>
              <ListChecks size={16} />
              Depuis le catalogue
            </Tabs.Trigger>
            <Tabs.Trigger value="hierarchy" className={TAB_TRIGGER}>
              <TreeStructure size={16} />
              Par filtre de gamme
            </Tabs.Trigger>
            <Tabs.Trigger value="import" className={TAB_TRIGGER}>
              <Table size={16} />
              Par fichier
            </Tabs.Trigger>
          </Tabs.List>

          <div className="pt-5">
            <Tabs.Content value="catalogue" className="focus:outline-none">
              <CatalogueSelectionPanel
                selectedIds={selectedIds}
                onAdd={handleAdd}
                onRemove={handleRemove}
              />
            </Tabs.Content>
            <Tabs.Content value="hierarchy" className="focus:outline-none">
              <HierarchyFilterPanel selectedIds={selectedIds} onAdd={handleAdd} />
            </Tabs.Content>
            <Tabs.Content value="import" className="focus:outline-none">
              <ImportFilePanel onAdd={handleAdd} onNotFound={mergeNotFound} />
            </Tabs.Content>
          </div>
        </Tabs.Root>

        <SelectedSkuList skus={selectedSkus} onRemove={handleRemove} onClear={handleClear} />
      </div>

      {/* Persistent side panel for not-found SKU (import method). */}
      <aside
        className={cn(
          "border rounded-xl bg-card shadow-sm h-fit lg:sticky lg:top-4",
          notFound.length > 0 ? "border-red-200" : "border-border"
        )}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-sm font-semibold text-foreground">
            SKU non trouvés{notFound.length > 0 ? ` (${notFound.length})` : ""}
          </span>
          {notFound.length > 0 && (
            <button
              type="button"
              onClick={() => setNotFound([])}
              className="text-xs font-semibold text-muted-foreground hover:text-destructive"
            >
              Vider
            </button>
          )}
        </div>
        {notFound.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            Les SKU importés introuvables en base apparaîtront ici.
          </p>
        ) : (
          <>
            <ul className="max-h-72 overflow-y-auto divide-y divide-[#F1F5F9]">
              {notFound.map((s) => (
                <li key={s} className="px-4 py-2 font-mono text-sm text-red-700 truncate">
                  {s}
                </li>
              ))}
            </ul>
            <div className="p-3 border-t border-border">
              <button
                type="button"
                onClick={downloadReport}
                className="flex items-center justify-center gap-2 w-full px-3 py-2 text-sm font-semibold text-muted-foreground border border-border rounded-lg hover:bg-muted"
              >
                <DownloadSimple size={15} />
                Télécharger le rapport
              </button>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
