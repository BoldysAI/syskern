"use client";

import { useState } from "react";
import { CheckCircle, CircleNotch, Warning } from "@phosphor-icons/react";
import {
  getTaskStatus,
  startBulkTranslate,
  type BulkTranslateResult,
} from "@/lib/api";
import { useUiTranslate } from "@/lib/use-ui-translate";
import { AppModal } from "@/components/AppModal";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

const TARGET_LANGS = [
  { code: "en", labelKey: "catalog.lang.en" },
  { code: "es", labelKey: "catalog.lang.esName" },
] as const;
const CONTENT_FIELDS = [
  { code: "marketing", labelKey: "catalog.bulk.marketing" },
  { code: "technical", labelKey: "catalog.bulk.technical" },
] as const;

type Phase = "config" | "running" | "done" | "error";

interface BulkTranslateDialogProps {
  productIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful run so the caller can refresh / clear selection. */
  onDone?: () => void;
}

export function BulkTranslateDialog({
  productIds,
  open,
  onOpenChange,
  onDone,
}: BulkTranslateDialogProps) {
  const t = useUiTranslate();
  const [targets, setTargets] = useState<string[]>(["en", "es"]);
  const [fields, setFields] = useState<string[]>(["marketing", "technical"]);
  const [phase, setPhase] = useState<Phase>("config");
  const [progress, setProgress] = useState({ current: 0, total: productIds.length });
  const [result, setResult] = useState<BulkTranslateResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setPhase("config");
    setProgress({ current: 0, total: productIds.length });
    setResult(null);
    setError(null);
  };

  const toggle = (
    list: string[],
    setList: (v: string[]) => void,
    code: string,
  ) => setList(list.includes(code) ? list.filter((x) => x !== code) : [...list, code]);

  const close = (nextOpen: boolean) => {
    if (!nextOpen && phase === "running") return; // don't close mid-run
    onOpenChange(nextOpen);
    if (!nextOpen) reset();
  };

  const run = async () => {
    setPhase("running");
    setError(null);
    setProgress({ current: 0, total: productIds.length });
    try {
      const { task_id } = await startBulkTranslate({
        ids: productIds,
        source_lang: "fr",
        target_langs: targets,
        content_fields: fields,
      });
      const start = Date.now();
      while (Date.now() - start < 600_000) {
        const s = await getTaskStatus<BulkTranslateResult>(task_id);
        if (s.progress) setProgress(s.progress);
        if (s.status === "SUCCESS") {
          setResult(s.result ?? null);
          setPhase("done");
          onDone?.();
          return;
        }
        if (s.status === "FAILURE") {
          setError(s.error || t("catalog.bulk.failed"));
          setPhase("error");
          return;
        }
        if (s.status === "REVOKED") {
          setError(t("catalog.bulk.revoked"));
          setPhase("error");
          return;
        }
        await new Promise((r) => setTimeout(r, 900));
      }
      setError(t("catalog.bulk.timeout"));
      setPhase("error");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("catalog.bulk.error"));
      setPhase("error");
    }
  };

  const canRun = targets.length > 0 && fields.length > 0 && productIds.length > 0;
  const pct = progress.total ? Math.round((100 * progress.current) / progress.total) : 0;

  const footer =
    phase === "config" ? (
      <>
        <Button variant="outline" onClick={() => close(false)}>
          {t("common.cancel")}
        </Button>
        <Button onClick={run} disabled={!canRun}>
          {t(
            productIds.length > 1 ? "catalog.bulk.translateCountOther" : "catalog.bulk.translateCountOne",
            { count: productIds.length },
          )}
        </Button>
      </>
    ) : phase === "running" ? (
      <Button disabled>
        <CircleNotch size={16} className="animate-spin" />
        {t("catalog.bulk.running")}
      </Button>
    ) : phase === "error" ? (
      <>
        <Button variant="outline" onClick={() => close(false)}>
          {t("common.close")}
        </Button>
        <Button onClick={run}>{t("catalog.action.retry")}</Button>
      </>
    ) : (
      <Button onClick={() => close(false)}>{t("common.close")}</Button>
    );

  return (
    <AppModal
      open={open}
      onOpenChange={close}
      title={t("catalog.bulk.title")}
      description={t(
        productIds.length > 1 ? "catalog.bulk.descriptionOther" : "catalog.bulk.descriptionOne",
        { count: productIds.length },
      )}
      size="md"
      footer={footer}
    >
      {phase === "config" && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label className="text-sm font-medium">{t("catalog.bulk.targetLangs")}</Label>
            <div className="flex flex-col gap-2">
              {TARGET_LANGS.map((lang) => (
                <label
                  key={lang.code}
                  className="flex cursor-pointer items-center gap-2.5 text-sm text-foreground"
                >
                  <Checkbox
                    checked={targets.includes(lang.code)}
                    onCheckedChange={() => toggle(targets, setTargets, lang.code)}
                  />
                  {t(lang.labelKey)}
                </label>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label className="text-sm font-medium">{t("catalog.bulk.fields")}</Label>
            <div className="flex flex-col gap-2">
              {CONTENT_FIELDS.map((field) => (
                <label
                  key={field.code}
                  className="flex cursor-pointer items-center gap-2.5 text-sm text-foreground"
                >
                  <Checkbox
                    checked={fields.includes(field.code)}
                    onCheckedChange={() => toggle(fields, setFields, field.code)}
                  />
                  {t(field.labelKey)}
                </label>
              ))}
            </div>
          </div>
          <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {t("catalog.bulk.hint")}
          </p>
        </div>
      )}

      {phase === "running" && (
        <div className="flex flex-col gap-3 py-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t("catalog.bulk.running")}</span>
            <span className="font-medium tabular-nums text-foreground">
              {progress.current} / {progress.total}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {phase === "done" && result && (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <CheckCircle size={40} weight="duotone" className="text-emerald-500" />
          <div>
            <p className="text-sm font-semibold text-foreground">{t("catalog.bulk.done")}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t(
                result.translated_fields > 1
                  ? result.processed > 1
                    ? "catalog.bulk.summaryFieldsOtherProductsOther"
                    : "catalog.bulk.summaryFieldsOtherProductsOne"
                  : result.processed > 1
                    ? "catalog.bulk.summaryFieldsOneProductsOther"
                    : "catalog.bulk.summaryFieldsOneProductsOne",
                { fields: result.translated_fields, products: result.processed },
              )}
            </p>
          </div>
          {result.skipped.length > 0 && (
            <div className="w-full rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-left text-xs text-muted-foreground">
              <p className="mb-1 font-medium text-foreground">
                {t("catalog.bulk.skipped", { count: result.skipped.length })}
              </p>
              <ul className="list-inside list-disc space-y-0.5">
                {result.skipped.slice(0, 5).map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {phase === "error" && (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <Warning size={40} weight="duotone" className="text-destructive" />
          <p className="text-sm text-foreground">{error}</p>
        </div>
      )}
    </AppModal>
  );
}
