"use client";

import { useState } from "react";
import useSWR from "swr";
import * as Select from "@radix-ui/react-select";
import { Check, CaretDown, Info } from "@phosphor-icons/react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { listIncoterms } from "@/lib/api";
import { LocationSelectField } from "@/components/LocationSelectField";
import { cn } from "@/lib/utils";
import {
  INCOTERM_IMPACT_FR,
  INCOTERMS_FALLBACK,
  localizeIncotermLabel,
} from "@/lib/incoterms";

const inputCls =
  "w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary";

interface Props {
  incoterm: string;
  location: string;
  disabled?: boolean;
  onIncotermChange: (code: string) => void;
  onLocationChange: (location: string) => void;
}

export function SaleIncotermFields({
  incoterm,
  location,
  disabled,
  onIncotermChange,
  onLocationChange,
}: Props) {
  const { data: incoterms } = useSWR("incoterms", listIncoterms);
  const impact = INCOTERM_IMPACT_FR[incoterm];
  const incotermOptions = incoterms ?? INCOTERMS_FALLBACK;
  const currentIncoterm = incoterm || "EXW";
  const incotermDisplay = (() => {
    const item = incotermOptions.find((i) => i.code === currentIncoterm);
    return item
      ? `${item.code} — ${localizeIncotermLabel(item.label, item.code)}`
      : currentIncoterm;
  })();

  return (
    <div className="flex flex-col gap-3">
      <div>
        <label className="block text-xs font-semibold text-muted-foreground mb-1.5">
          Incoterm de vente
        </label>
        <Select.Root value={currentIncoterm} onValueChange={onIncotermChange} disabled={disabled}>
          <Select.Trigger
            aria-label={`Incoterm de vente : ${incotermDisplay}`}
            className={cn(
              inputCls,
              "flex items-center justify-between gap-2 text-left disabled:opacity-50"
            )}
          >
            <span className="flex-1 truncate">{incotermDisplay}</span>
            <Select.Icon>
              <CaretDown size={15} className="shrink-0 text-muted-foreground" />
            </Select.Icon>
          </Select.Trigger>
          <Select.Portal>
            <Select.Content
              position="popper"
              sideOffset={4}
              className="z-50 max-h-64 min-w-[var(--radix-select-trigger-width)] bg-card border border-border rounded-lg shadow-lg overflow-hidden"
            >
              <Select.Viewport className="p-1">
                {(incoterms ?? INCOTERMS_FALLBACK).map((item) => (
                  <Select.Item
                    key={item.code}
                    value={item.code}
                    className="flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-md cursor-pointer select-none outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
                  >
                    <Select.ItemText>
                      {item.code} — {localizeIncotermLabel(item.label, item.code)}
                    </Select.ItemText>
                    <Select.ItemIndicator>
                      <Check size={14} className="text-warm" />
                    </Select.ItemIndicator>
                  </Select.Item>
                ))}
              </Select.Viewport>
            </Select.Content>
          </Select.Portal>
        </Select.Root>
      </div>

      <div>
        <label className="block text-xs font-semibold text-muted-foreground mb-1.5">
          Lieu incoterm vente
        </label>
        <LocationSelectField
          value={location}
          onChange={onLocationChange}
          disabled={disabled}
          ariaLabel="Lieu incoterm vente"
        />
      </div>

      {impact && (
        <p className="flex gap-2 text-xs text-muted-foreground leading-relaxed">
          <Info size={14} className="shrink-0 mt-0.5 text-warm" />
          {impact}
        </p>
      )}
    </div>
  );
}

interface ConfirmProps {
  open: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function IncotermPrefillConfirm({
  open,
  title,
  message,
  onConfirm,
  onCancel,
}: ConfirmProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{message}</p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Annuler
          </Button>
          <Button type="button" onClick={onConfirm}>
            Appliquer la structure
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Confirm before overwriting a chain when incoterm changes. */
export function useIncotermPrefillConfirm() {
  const [pending, setPending] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const request = (
    hasContent: boolean,
    title: string,
    message: string,
    apply: () => void
  ) => {
    if (!hasContent) {
      apply();
      return;
    }
    setPending({
      title,
      message,
      onConfirm: () => {
        apply();
        setPending(null);
      },
    });
  };

  const modal = pending ? (
    <IncotermPrefillConfirm
      open
      title={pending.title}
      message={pending.message}
      onConfirm={pending.onConfirm}
      onCancel={() => setPending(null)}
    />
  ) : null;

  return { request, modal };
}
