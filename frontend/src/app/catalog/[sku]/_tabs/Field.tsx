"use client";

import type { ProductDetail } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
      return <span className="text-muted-foreground/50">—</span>;
    if (kind === "toggle") {
      return (
        <span
          className={cn(
            "inline-flex rounded px-2 py-0.5 text-xs font-medium",
            value ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
          )}
        >
          {value ? "Oui" : "Non"}
        </span>
      );
    }
    if (kind === "number") {
      const n = Number(value);
      return (
        <span className="font-medium text-foreground">
          {Number.isFinite(n) ? n.toLocaleString("fr-FR") : String(value)}
          {unit && <span className="ml-1 text-muted-foreground">{unit}</span>}
        </span>
      );
    }
    if (kind === "select" && options) {
      const opt = options.find((o) => o.value === value);
      return <span className="font-medium text-foreground">{opt ? opt.label : String(value)}</span>;
    }
    return <span className="font-medium text-foreground">{String(value)}</span>;
  };

  const isMultiline = editable && kind === "textarea";

  return (
    <div
      className={cn(
        "gap-3 border-b border-border py-2.5 last:border-0",
        isMultiline ? "flex flex-col" : "flex items-center justify-between",
      )}
    >
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className={cn(isMultiline ? "w-full" : "max-w-[60%] min-w-[40%]", "text-right")}>
        {!editable ? (
          <span className="text-sm">{readDisplay()}</span>
        ) : kind === "toggle" ? (
          <Switch checked={value === true} onCheckedChange={(checked) => emit(checked)} />
        ) : kind === "textarea" ? (
          <Textarea
            value={value == null ? "" : String(value)}
            rows={3}
            onChange={(e) => emit(e.target.value)}
            className="resize-y text-left"
          />
        ) : kind === "select" && options ? (
          <Select value={(value as string) || undefined} onValueChange={(v) => emit(v)}>
            <SelectTrigger className="w-full text-left">
              <SelectValue placeholder="Sélectionner…" />
            </SelectTrigger>
            <SelectContent>
              {options.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="relative">
            <Input
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
              className={cn("text-left", unit && "pr-12")}
            />
            {unit && (
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                {unit}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
