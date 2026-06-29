"use client";

import { useMemo } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { Table, ListChecks } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { WizardCatalogPicker } from "./WizardCatalogPicker";
import { ImportFilePanel } from "./ImportFilePanel";
import { NotFoundSkuBanner } from "./NotFoundSkuBanner";
import { SelectedSkuList } from "./SelectedSkuList";
import type { SelectedSku } from "./wizard-draft";

interface Props {
  selectedSkus: SelectedSku[];
  notFoundSkus: string[];
  onChange: (skus: SelectedSku[]) => void;
  onNotFoundChange: (skus: string[]) => void;
  className?: string;
}

const TAB_TRIGGER =
  "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors data-[state=active]:border-primary data-[state=active]:text-accent-foreground data-[state=inactive]:border-transparent data-[state=inactive]:text-muted-foreground hover:text-foreground";

export function SkuStep({ selectedSkus, notFoundSkus, onChange, onNotFoundChange, className }: Props) {
  const selectedIds = useMemo(() => new Set(selectedSkus.map((s) => s.id)), [selectedSkus]);

  const handleAdd = (skus: SelectedSku[]) => {
    const byId = new Map(selectedSkus.map((s) => [s.id, s]));
    for (const s of skus) byId.set(s.id, s);
    onChange([...byId.values()]);
  };

  const handleRemove = (id: string) => onChange(selectedSkus.filter((s) => s.id !== id));
  const handleRemoveMany = (ids: string[]) => {
    const drop = new Set(ids);
    onChange(selectedSkus.filter((s) => !drop.has(s.id)));
  };
  const handleClear = () => onChange([]);

  const mergeNotFound = (skus: string[]) => {
    onNotFoundChange([...new Set([...notFoundSkus, ...skus])]);
  };

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col gap-3", className)}>
      <NotFoundSkuBanner skus={notFoundSkus} onClear={() => onNotFoundChange([])} />

      <Tabs.Root defaultValue="catalogue" className="flex min-h-0 flex-1 flex-col">
        <Tabs.List className="flex shrink-0 items-center gap-1 border-b border-border">
          <Tabs.Trigger value="catalogue" className={TAB_TRIGGER}>
            <ListChecks size={16} />
            Depuis le catalogue
          </Tabs.Trigger>
          <Tabs.Trigger value="import" className={TAB_TRIGGER}>
            <Table size={16} />
            Par fichier
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content
          value="catalogue"
          className="flex min-h-0 flex-1 flex-col pt-3 focus:outline-none data-[state=inactive]:hidden"
        >
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
            <WizardCatalogPicker
              selectedIds={selectedIds}
              onAdd={handleAdd}
              onRemove={handleRemove}
              onRemoveMany={handleRemoveMany}
              className="min-h-[min(60vh,480px)] lg:min-h-0"
            />
            <SelectedSkuList
              skus={selectedSkus}
              onRemove={handleRemove}
              onClear={handleClear}
              className="flex min-h-0 flex-col lg:max-h-none lg:h-full"
            />
          </div>
        </Tabs.Content>

        <Tabs.Content value="import" className="max-w-2xl pt-5 focus:outline-none data-[state=inactive]:hidden">
          <ImportFilePanel onAdd={handleAdd} onNotFound={mergeNotFound} />
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
