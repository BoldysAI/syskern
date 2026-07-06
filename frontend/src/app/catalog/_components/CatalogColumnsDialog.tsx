"use client";

import { useMemo, useState } from "react";
import { Columns } from "@phosphor-icons/react";
import type { AttributeRegistry } from "@/lib/api";
import { localize } from "@/components/AttributeRenderer";
import { AppModal } from "@/components/AppModal";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  attrColumnKey,
  CATALOG_CORE_COLUMN_META,
  DEFAULT_VISIBLE_CATALOG_COLUMNS,
  ensureLockedColumns,
} from "./catalog-column-registry";

interface CatalogColumnsDialogProps {
  attributes: AttributeRegistry[];
  visibleKeys: string[];
  onApply: (keys: string[]) => void;
  disabled?: boolean;
}

/**
 * Modal to choose which catalog columns are visible (core fields + dynamic attributes).
 */
export function CatalogColumnsDialog({
  attributes,
  visibleKeys,
  onApply,
  disabled,
}: CatalogColumnsDialogProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(visibleKeys);

  const openDialog = () => {
    setDraft(ensureLockedColumns(visibleKeys));
    setOpen(true);
  };

  const handleOpenChange = (next: boolean) => {
    if (next) setDraft(ensureLockedColumns(visibleKeys));
    setOpen(next);
  };

  const sortedAttrs = useMemo(
    () =>
      [...attributes].sort(
        (a, b) => a.display_order - b.display_order || a.code.localeCompare(b.code),
      ),
    [attributes],
  );

  const toggle = (key: string, locked?: boolean) => {
    if (locked) return;
    setDraft((prev) => {
      const set = new Set(prev);
      if (set.has(key)) set.delete(key);
      else set.add(key);
      return ensureLockedColumns([...set]);
    });
  };

  const handleReset = () => {
    setDraft([...DEFAULT_VISIBLE_CATALOG_COLUMNS]);
  };

  const handleApply = () => {
    onApply(ensureLockedColumns(draft));
    setOpen(false);
  };

  const selectedCount = draft.length;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        title="Choisir les colonnes"
        disabled={disabled}
        onClick={openDialog}
      >
        <Columns size={15} />
        <span className="hidden sm:inline">Colonnes</span>
        {selectedCount > 0 && (
          <span className="text-xs text-muted-foreground">({selectedCount})</span>
        )}
      </Button>

      <AppModal
        open={open}
        onOpenChange={handleOpenChange}
        title="Colonnes du catalogue"
        description="Cochez les colonnes à afficher dans le tableau. Le SKU reste toujours visible."
        size="lg"
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={handleReset}>
              Réinitialiser
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Annuler
              </Button>
              <Button type="button" onClick={handleApply}>
                Appliquer
              </Button>
            </div>
          </div>
        }
      >
        <div className="flex max-h-[min(60vh,28rem)] flex-col gap-6 overflow-y-auto pr-1">
          <section>
            <h3 className="mb-3 text-sm font-semibold text-foreground">Colonnes produit</h3>
            <ul className="flex flex-col gap-2">
              {CATALOG_CORE_COLUMN_META.map((col) => {
                const checked = draft.includes(col.key);
                return (
                  <li key={col.key}>
                    <label
                      className={
                        col.locked
                          ? "flex cursor-default items-center gap-3 rounded-lg px-2 py-2 opacity-70"
                          : "flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/60"
                      }
                    >
                      <Checkbox
                        checked={checked}
                        disabled={col.locked}
                        onCheckedChange={() => toggle(col.key, col.locked)}
                      />
                      <span className="text-sm text-foreground">{col.label}</span>
                      {col.locked && (
                        <span className="text-xs text-muted-foreground">(toujours affiché)</span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>

          <section>
            <h3 className="mb-3 text-sm font-semibold text-foreground">Attributs dynamiques</h3>
            {sortedAttrs.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun attribut défini dans le registre.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {sortedAttrs.map((attr) => {
                  const key = attrColumnKey(attr.code);
                  const checked = draft.includes(key);
                  return (
                    <li key={attr.id}>
                      <Label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 font-normal hover:bg-muted/60">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggle(key)}
                        />
                        <span className="text-sm text-foreground">{localize(attr.label)}</span>
                      </Label>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </AppModal>
    </>
  );
}
