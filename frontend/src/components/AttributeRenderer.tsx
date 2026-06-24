"use client";

import { useMemo } from "react";
import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown, Plus, X } from "lucide-react";
import type { AttributeRegistry } from "@/lib/api";
import { cn } from "@/lib/utils";

export type AttributeRenderMode = "read" | "edit";

interface AttributeRendererProps {
  attribute: AttributeRegistry;
  value: unknown;
  mode: AttributeRenderMode;
  /** Language used for labels / option labels. Defaults to "fr". */
  lang?: string;
  /** Edit mode: fired on every change with the new value and its validity. */
  onChange?: (value: unknown, valid: boolean) => void;
}

const inputCls =
  "w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:bg-slate-50 disabled:text-slate-400";

/** Pick the best localized string from a multilingual map. */
export function localize(map: Record<string, string> | undefined | null, lang = "fr"): string {
  if (!map) return "";
  return map[lang] || map.fr || Object.values(map)[0] || "";
}

/**
 * Client-side validation mirroring the backend `_validate_attribute_value`
 * (CDC §4.5). `null` / empty is always valid (clears the value).
 */
export function validateAttributeValue(attribute: AttributeRegistry, value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;

  switch (attribute.data_type) {
    case "text":
      return typeof value === "string";
    case "number":
      return Number.isFinite(Number(value));
    case "boolean":
      return typeof value === "boolean";
    case "date":
      return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
    case "select": {
      const allowed = new Set((attribute.options ?? []).map((o) => o.value));
      return typeof value === "string" && allowed.has(value);
    }
    case "multiselect": {
      const allowed = new Set((attribute.options ?? []).map((o) => o.value));
      return Array.isArray(value) && value.every((v) => allowed.has(String(v)));
    }
    default:
      return false;
  }
}

function formatDateFr(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

// ─── Read-mode rendering ────────────────────────────────────────────────────

function ReadValue({
  attribute,
  value,
  lang,
}: {
  attribute: AttributeRegistry;
  value: unknown;
  lang: string;
}) {
  const empty = value === null || value === undefined || value === "";
  if (empty) return <span className="text-slate-300">—</span>;

  switch (attribute.data_type) {
    case "number": {
      const n = Number(value);
      const formatted = Number.isFinite(n) ? n.toLocaleString("fr-FR") : String(value);
      return (
        <span className="font-medium text-slate-800">
          {formatted}
          {attribute.unit && <span className="text-slate-400 ml-1">{attribute.unit}</span>}
        </span>
      );
    }
    case "boolean":
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
    case "date":
      return <span className="font-medium text-slate-800">{formatDateFr(String(value))}</span>;
    case "select": {
      const opt = (attribute.options ?? []).find((o) => o.value === value);
      return (
        <span className="font-medium text-slate-800">
          {opt ? localize(opt.label, lang) : String(value)}
        </span>
      );
    }
    case "multiselect": {
      const arr = Array.isArray(value) ? value : [];
      if (arr.length === 0) return <span className="text-slate-300">—</span>;
      return (
        <span className="flex flex-wrap gap-1 justify-end">
          {arr.map((v) => {
            const opt = (attribute.options ?? []).find((o) => o.value === String(v));
            return (
              <span
                key={String(v)}
                className="inline-flex px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-xs"
              >
                {opt ? localize(opt.label, lang) : String(v)}
              </span>
            );
          })}
        </span>
      );
    }
    default:
      return <span className="font-medium text-slate-800">{String(value)}</span>;
  }
}

// ─── Edit-mode widgets ──────────────────────────────────────────────────────

function EditWidget({
  attribute,
  value,
  lang,
  onChange,
}: {
  attribute: AttributeRegistry;
  value: unknown;
  lang: string;
  onChange: (value: unknown, valid: boolean) => void;
}) {
  const emit = (v: unknown) => onChange(v, validateAttributeValue(attribute, v));

  switch (attribute.data_type) {
    case "text": {
      const str = value == null ? "" : String(value);
      // Long content → textarea, short → single-line input.
      if (str.length > 60) {
        return (
          <textarea
            value={str}
            rows={3}
            onChange={(e) => emit(e.target.value)}
            className={cn(inputCls, "resize-y")}
          />
        );
      }
      return <input value={str} onChange={(e) => emit(e.target.value)} className={inputCls} />;
    }

    case "number": {
      const str = value == null ? "" : String(value);
      const valid = validateAttributeValue(attribute, str);
      return (
        <div className="relative">
          <input
            type="number"
            inputMode="decimal"
            value={str}
            onChange={(e) => emit(e.target.value === "" ? null : e.target.value)}
            className={cn(
              inputCls,
              attribute.unit && "pr-12",
              !valid && "border-red-400 focus:ring-red-200 focus:border-red-400",
            )}
          />
          {attribute.unit && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400 pointer-events-none">
              {attribute.unit}
            </span>
          )}
        </div>
      );
    }

    case "boolean": {
      const on = value === true;
      return (
        <button
          type="button"
          role="switch"
          aria-checked={on}
          onClick={() => emit(!on)}
          className={cn(
            "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
            on ? "bg-primary" : "bg-slate-300",
          )}
        >
          <span
            className={cn(
              "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
              on ? "translate-x-6" : "translate-x-1",
            )}
          />
        </button>
      );
    }

    case "date": {
      const str = typeof value === "string" ? value : "";
      return (
        <input
          type="date"
          value={str}
          onChange={(e) => emit(e.target.value === "" ? null : e.target.value)}
          className={inputCls}
        />
      );
    }

    case "select":
      return <SelectWidget attribute={attribute} value={value} lang={lang} onEmit={emit} />;

    case "multiselect":
      return <MultiSelectWidget attribute={attribute} value={value} lang={lang} onEmit={emit} />;

    default:
      return null;
  }
}

function SelectWidget({
  attribute,
  value,
  lang,
  onEmit,
}: {
  attribute: AttributeRegistry;
  value: unknown;
  lang: string;
  onEmit: (v: unknown) => void;
}) {
  const current = typeof value === "string" ? value : "";
  return (
    <Select.Root value={current || undefined} onValueChange={(v) => onEmit(v)}>
      <Select.Trigger
        className={cn(inputCls, "flex items-center justify-between gap-2 text-left")}
        aria-label={localize(attribute.label, lang)}
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
          className="z-50 min-w-[var(--radix-select-trigger-width)] bg-white border border-border rounded-lg shadow-lg overflow-hidden"
        >
          <Select.Viewport className="p-1">
            {(attribute.options ?? []).map((opt) => (
              <Select.Item
                key={opt.value}
                value={opt.value}
                className="flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-md cursor-pointer select-none outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
              >
                <Select.ItemText>{localize(opt.label, lang)}</Select.ItemText>
                <Select.ItemIndicator>
                  <Check size={14} className="text-warm" />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

function MultiSelectWidget({
  attribute,
  value,
  lang,
  onEmit,
}: {
  attribute: AttributeRegistry;
  value: unknown;
  lang: string;
  onEmit: (v: unknown) => void;
}) {
  const selected = Array.isArray(value) ? (value as string[]).map(String) : [];
  const options = attribute.options ?? [];
  const remaining = options.filter((o) => !selected.includes(o.value));

  const add = (v: string) => onEmit([...selected, v]);
  const remove = (v: string) => onEmit(selected.filter((x) => x !== v));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5 min-h-[2.25rem] px-2 py-1.5 border border-border rounded-lg">
        {selected.length === 0 && (
          <span className="text-sm text-slate-300 px-1 py-0.5">Aucune sélection</span>
        )}
        {selected.map((v) => {
          const opt = options.find((o) => o.value === v);
          return (
            <span
              key={v}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-accent text-accent-foreground text-xs font-medium"
            >
              {opt ? localize(opt.label, lang) : v}
              <button
                type="button"
                onClick={() => remove(v)}
                aria-label={`Retirer ${v}`}
                className="hover:text-warm"
              >
                <X size={12} />
              </button>
            </span>
          );
        })}
      </div>
      {remaining.length > 0 && (
        <Select.Root value="" onValueChange={(v) => v && add(v)}>
          <Select.Trigger className="inline-flex items-center gap-1.5 self-start px-2.5 py-1.5 text-xs font-medium text-warm border border-dashed border-primary/40 rounded-lg hover:bg-accent/50">
            <Plus size={13} />
            Ajouter
          </Select.Trigger>
          <Select.Portal>
            <Select.Content
              position="popper"
              sideOffset={4}
              className="z-50 bg-white border border-border rounded-lg shadow-lg overflow-hidden"
            >
              <Select.Viewport className="p-1">
                {remaining.map((opt) => (
                  <Select.Item
                    key={opt.value}
                    value={opt.value}
                    className="px-3 py-2 text-sm rounded-md cursor-pointer select-none outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
                  >
                    <Select.ItemText>{localize(opt.label, lang)}</Select.ItemText>
                  </Select.Item>
                ))}
              </Select.Viewport>
            </Select.Content>
          </Select.Portal>
        </Select.Root>
      )}
    </div>
  );
}

/**
 * Adaptive widget for a dynamic attribute (CDC §4.5).
 * Renders a labelled row; the right side adapts to `data_type` and `mode`.
 */
export function AttributeRenderer({
  attribute,
  value,
  mode,
  lang = "fr",
  onChange,
}: AttributeRendererProps) {
  const label = useMemo(() => localize(attribute.label, lang), [attribute.label, lang]);
  const isMultiline =
    mode === "edit" &&
    (attribute.data_type === "multiselect" ||
      (attribute.data_type === "text" && typeof value === "string" && value.length > 60));

  return (
    <div
      className={cn(
        "gap-3 py-2.5 border-b border-border last:border-0",
        isMultiline ? "flex flex-col" : "flex items-center justify-between",
      )}
    >
      <span className="text-sm text-slate-500">
        {label}
        {attribute.is_required && <span className="text-red-400 ml-0.5">*</span>}
      </span>
      <div className={cn(isMultiline ? "w-full" : "max-w-[60%] min-w-[40%]", "text-right")}>
        {mode === "edit" && onChange ? (
          <EditWidget attribute={attribute} value={value} lang={lang} onChange={onChange} />
        ) : (
          <span className="text-sm">
            <ReadValue attribute={attribute} value={value} lang={lang} />
          </span>
        )}
      </div>
    </div>
  );
}
