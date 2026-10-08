"use client";

import { useState } from "react";
import { Bookmark, CircleNotch } from "@phosphor-icons/react";
import { createSavedComparison } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { translate } from "@/lib/i18n";
import { useUiTranslate } from "@/lib/use-ui-translate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onClose: () => void;
  simulationIds: string[];
  recalculationIds: string[];
  defaultLabel?: string;
  onSaved: (id: string) => void;
}

function defaultComparisonLabel(locale: string, fallback?: string) {
  return (
    fallback?.trim() ||
    translate("simulator.compare.defaultLabel", locale, {
      date: new Date().toLocaleDateString("fr-FR"),
    })
  );
}

export function SaveComparisonModal({
  open,
  onClose,
  simulationIds,
  recalculationIds,
  defaultLabel,
  onSaved,
}: Props) {
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      {open ? (
        <SaveComparisonForm
          simulationIds={simulationIds}
          recalculationIds={recalculationIds}
          defaultLabel={defaultLabel}
          onSaved={onSaved}
          onClose={onClose}
        />
      ) : null}
    </Dialog>
  );
}

function SaveComparisonForm({
  simulationIds,
  recalculationIds,
  defaultLabel,
  onSaved,
  onClose,
}: Omit<Props, "open">) {
  const t = useUiTranslate();
  const { displayLanguage } = useAuth();
  const [label, setLabel] = useState(() => defaultComparisonLabel(displayLanguage, defaultLabel));
  const [note, setNote] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (running) return;
    onClose();
  };

  const handleSave = async () => {
    setRunning(true);
    setError(null);
    try {
      const saved = await createSavedComparison({
        label: label.trim(),
        simulation_ids: simulationIds,
        recalculation_ids: recalculationIds,
        note: note.trim() || undefined,
      });
      onSaved(saved.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("simulator.saveFailed"));
    } finally {
      setRunning(false);
    }
  };

  return (
    <DialogContent className="max-w-md gap-0 p-0" showCloseButton={!running}>
      <DialogHeader className="border-b border-border p-5">
        <DialogTitle className="flex items-center gap-2">
          <Bookmark size={18} className="text-warm" />
          {t("simulator.compare.saveTitle")}
        </DialogTitle>
      </DialogHeader>

      <div className="flex flex-col gap-3 p-5">
        <p className="text-sm text-muted-foreground">
          {simulationIds.length !== 1
            ? t("simulator.compare.summaryOther", { count: simulationIds.length })
            : t("simulator.compare.summaryOne", { count: simulationIds.length })}
          {recalculationIds.length > 0 &&
            (recalculationIds.length !== 1
              ? t("simulator.compare.snapshotsOther", { count: recalculationIds.length })
              : t("simulator.compare.snapshotsOne", { count: recalculationIds.length }))}
          {t("simulator.compare.reopen")}
        </p>
        <div>
          <label htmlFor="save-compare-label" className="mb-1.5 block text-xs font-semibold text-muted-foreground">
            {t("simulator.compare.name")}
          </label>
          <Input
            id="save-compare-label"
            value={label}
            disabled={running}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && label.trim()) handleSave();
            }}
            placeholder={t("simulator.compare.namePlaceholder")}
            autoComplete="off"
          />
        </div>
        <div>
          <label htmlFor="save-compare-note" className="mb-1.5 block text-xs font-semibold text-muted-foreground">
            {t("simulator.compare.note")}
          </label>
          <Textarea
            id="save-compare-note"
            value={note}
            disabled={running}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
          />
        </div>
        {error && (
          <div className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={close} disabled={running}>
          {t("common.cancel")}
        </Button>
        <Button
          type="button"
          onClick={handleSave}
          disabled={running || !label.trim()}
          className="gap-2"
        >
          {running && <CircleNotch size={14} className="animate-spin" />}
          {t("common.save")}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
