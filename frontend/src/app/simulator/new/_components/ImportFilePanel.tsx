"use client";

import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Table, CircleNotch, CloudArrowUp } from "@phosphor-icons/react";
import { FilterSelect } from "@/components/FilterSelect";
import { lookupBulkProducts } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { SelectedSku } from "./wizard-draft";

interface Props {
  onAdd: (skus: SelectedSku[]) => void;
  onNotFound: (skus: string[]) => void;
}

const ACCEPT = ".xlsx,.xls,.csv";

/** Heuristic: find the header that looks like a `sku_code` column. */
function detectSkuColumn(headers: string[]): string | null {
  const norm = (h: string) => h.toLowerCase().replace(/[\s_-]/g, "");
  const exact = headers.find((h) => ["skucode", "sku"].includes(norm(h)));
  if (exact) return exact;
  const partial = headers.find((h) => norm(h).includes("sku"));
  return partial ?? null;
}

export function ImportFilePanel({ onAdd, onNotFound }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [column, setColumn] = useState<string>("");
  const [summary, setSummary] = useState<{ found: number; notFound: number } | null>(null);

  const reset = () => {
    setError(null);
    setSummary(null);
    setHeaders([]);
    setRows([]);
    setColumn("");
  };

  const resolveColumn = async (col: string, parsedRows: Record<string, unknown>[]) => {
    const skus = parsedRows
      .map((r) => r[col])
      .filter((v): v is string | number => v !== null && v !== undefined && v !== "")
      .map((v) => String(v).trim())
      .filter(Boolean);

    if (skus.length === 0) {
      setError("La colonne sélectionnée ne contient aucun SKU.");
      return;
    }

    setParsing(true);
    setError(null);
    try {
      const res = await lookupBulkProducts(skus);
      onAdd(res.found.map((p) => ({ id: p.id, sku_code: p.sku_code, name: p.name })));
      onNotFound(res.not_found);
      setSummary({ found: res.found.length, notFound: res.not_found.length });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de la résolution des SKU.");
    } finally {
      setParsing(false);
    }
  };

  const handleFile = async (file: File) => {
    reset();
    setFileName(file.name);
    setParsing(true);
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer);
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) {
        setError("Le fichier ne contient aucune feuille.");
        return;
      }
      const parsedRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: "",
      });
      const headerRow =
        (XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 })[0] ?? []).map(String);

      if (headerRow.length === 0 || parsedRows.length === 0) {
        setError("Le fichier est vide.");
        return;
      }

      setHeaders(headerRow);
      setRows(parsedRows);

      const detected = detectSkuColumn(headerRow);
      if (detected) {
        setColumn(detected);
        await resolveColumn(detected, parsedRows);
      } else {
        // Ask the user to pick the column.
        setColumn("");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fichier illisible (format non supporté ?).");
    } finally {
      setParsing(false);
    }
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    e.target.value = "";
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={cn(
          "flex flex-col items-center justify-center gap-2 py-10 px-4 rounded-xl border-2 border-dashed transition-colors text-center",
          dragOver
            ? "border-primary bg-accent"
            : "border-border hover:border-primary/60 hover:bg-muted"
        )}
      >
        <CloudArrowUp size={28} className="text-warm" />
        <span className="text-sm font-semibold text-foreground">
          Glissez un fichier ou cliquez pour sélectionner
        </span>
        <span className="text-xs text-muted-foreground">Formats acceptés : .xlsx, .xls, .csv — colonne « sku_code »</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        onChange={onInputChange}
        className="hidden"
      />

      {fileName && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Table size={16} className="text-muted-foreground" />
          <span className="truncate">{fileName}</span>
          {parsing && <CircleNotch size={14} className="animate-spin text-warm" />}
        </div>
      )}

      {/* Column picker shown only when auto-detection failed. */}
      {headers.length > 0 && !column && !parsing && (
        <div className="flex flex-col gap-2 rounded-lg border border-warm/30 bg-warm/10 p-3">
          <p className="text-sm text-foreground">
            Colonne « sku_code » non détectée. Sélectionnez la colonne contenant les SKU :
          </p>
          <FilterSelect
            value={column}
            onChange={(v) => {
              setColumn(v);
              if (v) void resolveColumn(v, rows);
            }}
            placeholder="— Choisir une colonne —"
            options={headers.map((h) => ({ value: h, label: h }))}
          />
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {summary && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
          {summary.found} SKU trouvé{summary.found !== 1 ? "s" : ""} et ajouté
          {summary.found !== 1 ? "s" : ""}.
          {summary.notFound > 0 && (
            <>
              {" "}
              {summary.notFound} non trouvé{summary.notFound !== 1 ? "s" : ""} (voir la bannière d&apos;erreur ci-dessus).
            </>
          )}
        </div>
      )}
    </div>
  );
}
