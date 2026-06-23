"use client";

import { useState } from "react";
import useSWR from "swr";
import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown, Info } from "lucide-react";
import { listIncoterms } from "@/lib/api";
import { LocationSelectField } from "@/components/LocationSelectField";
import { cn } from "@/lib/utils";
import {
  INCOTERM_IMPACT_FR,
  INCOTERMS_FALLBACK,
  localizeIncotermLabel,
} from "@/lib/incoterms";

const inputCls =
  "w-full px-3 py-2 text-sm border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#E07200]/30 focus:border-[#E07200]";

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
        <label className="block text-xs font-semibold text-slate-600 mb-1.5">
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
              <ChevronDown size={15} className="text-slate-400 shrink-0" />
            </Select.Icon>
          </Select.Trigger>
          <Select.Portal>
            <Select.Content
              position="popper"
              sideOffset={4}
              className="z-50 max-h-64 min-w-[var(--radix-select-trigger-width)] bg-white border border-[#E2E8F0] rounded-lg shadow-lg overflow-hidden"
            >
              <Select.Viewport className="p-1">
                {(incoterms ?? INCOTERMS_FALLBACK).map((item) => (
                  <Select.Item
                    key={item.code}
                    value={item.code}
                    className="flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-md cursor-pointer select-none outline-none data-[highlighted]:bg-[#FFF3E0] data-[highlighted]:text-[#C56400]"
                  >
                    <Select.ItemText>
                      {item.code} — {localizeIncotermLabel(item.label, item.code)}
                    </Select.ItemText>
                    <Select.ItemIndicator>
                      <Check size={14} className="text-[#E07200]" />
                    </Select.ItemIndicator>
                  </Select.Item>
                ))}
              </Select.Viewport>
            </Select.Content>
          </Select.Portal>
        </Select.Root>
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1.5">
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
        <p className="flex gap-2 text-xs text-slate-500 leading-relaxed">
          <Info size={14} className="shrink-0 mt-0.5 text-[#E07200]" />
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
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        <p className="mt-2 text-sm text-slate-600">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-2 text-sm border border-[#E2E8F0] rounded-lg text-slate-600 hover:bg-slate-50"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-3 py-2 text-sm font-medium text-white bg-[#E07200] rounded-lg hover:bg-[#C56400]"
          >
            Appliquer la structure
          </button>
        </div>
      </div>
    </div>
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
