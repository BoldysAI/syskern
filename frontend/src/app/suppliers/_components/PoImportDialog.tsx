"use client";

import { useRef, useState } from "react";
import { mutate } from "swr";
import {
  CheckCircle,
  DownloadSimple,
  FileXls,
  WarningCircle,
} from "@phosphor-icons/react";
import { AppModal } from "@/components/AppModal";
import { AppIcon } from "@/components/AppIcon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getTaskStatus, startPoImport, type PoImportResult } from "@/lib/api";

type Phase = "idle" | "running" | "done" | "error";

export function PoImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [result, setResult] = useState<PoImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pickFile = (f: File | null) => {
    if (!f) return;
    if (!/\.(xlsx|xlsm)$/i.test(f.name)) {
      setError("Format attendu : fichier Excel (.xlsx).");
      return;
    }
    setError(null);
    setFile(f);
  };

  const runImport = async () => {
    if (!file) return;
    setPhase("running");
    setError(null);
    setProgress(null);
    try {
      const { task_id } = await startPoImport(file);
      const start = Date.now();
      while (Date.now() - start < 600_000) {
        const s = await getTaskStatus<PoImportResult>(task_id);
        if (s.progress) setProgress(s.progress);
        if (s.status === "SUCCESS") {
          setResult(s.result ?? null);
          setPhase("done");
          await mutate("suppliers");
          return;
        }
        if (s.status === "FAILURE") {
          setError(s.error || "L'import a échoué.");
          setPhase("error");
          return;
        }
        await new Promise((r) => setTimeout(r, 900));
      }
      setError("Délai d'attente dépassé.");
      setPhase("error");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erreur");
      setPhase("error");
    }
  };

  const reset = () => {
    setFile(null);
    setPhase("idle");
    setProgress(null);
    setResult(null);
    setError(null);
  };

  const downloadReport = () => {
    if (!result?.report_url) return;
    const link = document.createElement("a");
    link.href = result.report_url;
    link.click();
  };

  const pct =
    progress && progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : null;

  return (
    <AppModal
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Importer des PO fournisseurs"
      description="Fichier Excel avec les colonnes : SKU / fournisseur / PO."
      size="lg"
    >
      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AppIcon icon={WarningCircle} size="sm" />
          <span>{error}</span>
        </div>
      )}

      {phase === "done" && result ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2 text-brand-green">
            <AppIcon icon={CheckCircle} size="md" weight="duotone" />
            <span className="text-sm font-semibold text-foreground">Import terminé</span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <SummaryTile label="Mis à jour" value={result.updated} tone="success" />
            <SummaryTile label="Créés" value={result.created} tone="info" />
            <SummaryTile label="Rejetés" value={result.rejected} tone="warning" />
          </div>
          {result.rejected > 0 && (
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <p className="text-sm text-muted-foreground">
                {result.rejected} ligne{result.rejected !== 1 ? "s" : ""} rejetée
                {result.rejected !== 1 ? "s" : ""} (SKU ou fournisseur introuvable, PO invalide).
                Téléchargez le rapport pour le détail.
              </p>
              {result.report_url && (
                <Button variant="outline" size="sm" className="mt-2" onClick={downloadReport}>
                  <AppIcon icon={DownloadSimple} size="sm" />
                  Télécharger le rapport
                </Button>
              )}
            </div>
          )}
          <div className="flex gap-3 pt-2">
            <Button variant="outline" className="flex-1" onClick={reset}>
              Importer un autre fichier
            </Button>
            <Button className="flex-1" onClick={onClose}>
              Fermer
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              pickFile(e.dataTransfer.files?.[0] ?? null);
            }}
            disabled={phase === "running"}
            className={cn(
              "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors",
              dragOver ? "border-primary bg-primary/5" : "border-border bg-muted/30",
              phase === "running" && "opacity-60",
            )}
          >
            <AppIcon icon={FileXls} size="lg" className="text-muted-foreground" />
            {file ? (
              <span className="text-sm font-medium text-foreground">{file.name}</span>
            ) : (
              <>
                <span className="text-sm font-medium text-foreground">
                  Glissez un fichier ici ou cliquez pour choisir
                </span>
                <span className="text-xs text-muted-foreground">Formats acceptés : .xlsx</span>
              </>
            )}
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xlsm"
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
          </button>

          {phase === "running" && (
            <div className="flex flex-col gap-1.5">
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{ width: pct !== null ? `${pct}%` : "40%" }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {progress
                  ? `Traitement ${progress.current} / ${progress.total}…`
                  : "Import en cours…"}
              </p>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={onClose}
              disabled={phase === "running"}
            >
              Annuler
            </Button>
            <Button
              className="flex-1"
              onClick={runImport}
              disabled={!file || phase === "running"}
            >
              {phase === "running" ? "Import…" : "Lancer l'import"}
            </Button>
          </div>
        </div>
      )}
    </AppModal>
  );
}

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "success" | "info" | "warning";
}) {
  const toneClass = {
    success: "text-brand-green",
    info: "text-brand-blue",
    warning: "text-warm",
  }[tone];
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-3 text-center">
      <div className={cn("font-data text-2xl font-bold", toneClass)}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
