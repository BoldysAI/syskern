"use client";

import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import type { ProductDetail } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useEdit } from "./edit-context";

export type FieldKind = "text" | "textarea" | "number" | "int" | "toggle" | "select";

interface FieldProps {
  field: keyof ProductDetail;
  label: string;
  kind?: FieldKind;
  unit?: string;
  options?: { value: string; label: string }[];
  /** Always rendered read-only (e.g. immutable identifiers like SKU). */
  readOnly?: boolean;
}

const inputCls =
  "w-full px-3 py-2 text-sm border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#E07200]/30 focus:border-[#E07200]";

function validate(kind: FieldKind, value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;
  switch (kind) {
    case "number":
      return Number.isFinite(Number(value));
    case "int":
      return Number.isInteger(Number(value));
    case "toggle":
      return typeof value === "boolean";
    default:
      return true;
  }
}

export function Field({ field, label, kind = "text", unit, options, readOnly }: FieldProps) {
  const { mode, coreValue, setCore } = useEdit();
  const value = coreValue(field);
  const editable = mode === "edit" && !readOnly;

  const emit = (v: unknown) => setCore(field, v, validate(kind, v));

  const readDisplay = () => {
    if (value === null || value === undefined || value === "")
      return <span className="text-slate-300">—</span>;
    if (kind === "toggle") {
      return (
        <span
          className={cn(
            "inline-flex px-2 py-0.5 rounded text-xs font-medium",
            value ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500",
          )}
        >
          {value ? "Oui" : "Non"}
        </span>
      );
    }
    if (kind === "number") {
      const n = Number(value);
      return (
        <span className="font-medium text-slate-800">
          {Number.isFinite(n) ? n.toLocaleString("fr-FR") : String(value)}
          {unit && <span className="text-slate-400 ml-1">{unit}</span>}
        </span>
      );
    }
    if (kind === "select" && options) {
      const opt = options.find((o) => o.value === value);
      return <span className="font-medium text-slate-800">{opt ? opt.label : String(value)}</span>;
    }
    return <span className="font-medium text-slate-800">{String(value)}</span>;
  };

  const isMultiline = editable && kind === "textarea";

  return (
    <div
      className={cn(
        "gap-3 py-2.5 border-b border-[#E2E8F0] last:border-0",
        isMultiline ? "flex flex-col" : "flex items-center justify-between",
      )}
    >
      <span className="text-sm text-slate-500">{label}</span>
      <div className={cn(isMultiline ? "w-full" : "max-w-[60%] min-w-[40%]", "text-right")}>
        {!editable ? (
          <span className="text-sm">{readDisplay()}</span>
        ) : kind === "toggle" ? (
          <button
            type="button"
            role="switch"
            aria-checked={value === true}
            onClick={() => emit(!(value === true))}
            className={cn(
              "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
              value === true ? "bg-[#E07200]" : "bg-slate-300",
            )}
          >
            <span
              className={cn(
                "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
                value === true ? "translate-x-6" : "translate-x-1",
              )}
            />
          </button>
        ) : kind === "textarea" ? (
          <textarea
            value={value == null ? "" : String(value)}
            rows={3}
            onChange={(e) => emit(e.target.value)}
            className={cn(inputCls, "resize-y text-left")}
          />
        ) : kind === "select" && options ? (
          <Select.Root value={(value as string) || undefined} onValueChange={(v) => emit(v)}>
            <Select.Trigger
              className={cn(inputCls, "flex items-center justify-between gap-2 text-left")}
            >
              <Select.Value placeholder="Sélectionner…" />
              <Select.Icon>
                <ChevronDown size={15} className="text-slate-400" />
              </Select.Icon>
            </Select.Trigger>
            <Select.Portal>
              <Select.Content
                position="popper"
                sideOffset={4}
                className="z-50 min-w-[var(--radix-select-trigger-width)] bg-white border border-[#E2E8F0] rounded-lg shadow-lg overflow-hidden"
              >
                <Select.Viewport className="p-1">
                  {options.map((opt) => (
                    <Select.Item
                      key={opt.value}
                      value={opt.value}
                      className="flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-md cursor-pointer select-none outline-none data-[highlighted]:bg-[#FFF3E0] data-[highlighted]:text-[#C56400]"
                    >
                      <Select.ItemText>{opt.label}</Select.ItemText>
                      <Select.ItemIndicator>
                        <Check size={14} className="text-[#E07200]" />
                      </Select.ItemIndicator>
                    </Select.Item>
                  ))}
                </Select.Viewport>
              </Select.Content>
            </Select.Portal>
          </Select.Root>
        ) : (
          <div className="relative">
            <input
              type={kind === "number" || kind === "int" ? "number" : "text"}
              inputMode={kind === "number" ? "decimal" : kind === "int" ? "numeric" : undefined}
              step={kind === "int" ? 1 : undefined}
              value={value == null ? "" : String(value)}
              onChange={(e) =>
                emit(
                  e.target.value === "" && (kind === "number" || kind === "int")
                    ? null
                    : e.target.value,
                )
              }
              className={cn(inputCls, "text-left", unit && "pr-12")}
            />
            {unit && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400 pointer-events-none">
                {unit}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
