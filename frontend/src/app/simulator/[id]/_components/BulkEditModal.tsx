"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CircleNotch } from "@phosphor-icons/react";
import { bulkEditLines, bulkEditPreview, type BulkEditFilter } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/ConfirmProvider";
import { StockPurchaseMixSlider } from "@/app/simulator/_components/StockPurchaseMixSlider";
import { normalizeIntegerQuantity, normalizePaCoefficient } from "@/app/simulator/new/_components/wizard-draft";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useUiTranslate } from "@/lib/use-ui-translate";
import type { MessageKey } from "@/lib/i18n";

interface Props {
  simId: string;
  open: boolean;
  onClose: () => void;
  onApplied: () => void;
  /** When set, applies only to these simulation line ids (skips filter UI). */
  lineIds?: string[] | null;
  /** Project simulations expose quantity + auto/manual mix controls. */
  isProject?: boolean;
  /** Pre-fill the filter (table sidebar filters) — filter mode only. */
  initialFilter?: BulkEditFilter;
}

type ActionType = "set_overrides" | "reset";
type MixMode = "" | "auto" | "manual";

const labelCls = "mb-1.5 block text-xs font-semibold text-muted-foreground";
const inputCls =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30";

export function BulkEditModal({
  simId,
  open,
  onClose,
  onApplied,
  lineIds,
  isProject = false,
  initialFilter,
}: Props) {
  const t = useUiTranslate();
  const confirm = useConfirm();
  const selectionMode = Boolean(lineIds && lineIds.length > 0);
  const [action, setAction] = useState<ActionType>("set_overrides");
  const [marginPct, setMarginPct] = useState("20");
  const [applyMix, setApplyMix] = useState(true);
  const [mixPct, setMixPct] = useState(50);
  const [qty, setQty] = useState("");
  const [paCoef, setPaCoef] = useState("");
  const [mixMode, setMixMode] = useState<MixMode>("");
  const [count, setCount] = useState<number | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeFilter = useMemo<BulkEditFilter>(
    () => (selectionMode ? { line_ids: lineIds! } : (initialFilter ?? {})),
    [selectionMode, lineIds, initialFilter],
  );

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPreviewing(true);
      bulkEditPreview(simId, activeFilter)
        .then((r) => setCount(r.count))
        .catch(() => setCount(null))
        .finally(() => setPreviewing(false));
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [simId, activeFilter, open]);

  const handleApply = async () => {
    setError(null);
    const marginSet = marginPct.trim() !== "";
    const qtySet = isProject && qty.trim() !== "";
    const paCoefSet = paCoef.trim() !== "";
    if (action === "set_overrides") {
      if (marginSet) {
        const n = parseFloat(marginPct);
        if (!Number.isFinite(n) || n < 0 || n >= 100) {
          setError(t("simulator.bulk.invalidMargin"));
          return;
        }
      }
      if (paCoefSet && !normalizePaCoefficient(paCoef)) {
        setError(t("simulator.bulk.invalidCoef"));
        return;
      }
      if (!marginSet && !applyMix && !qtySet && !paCoefSet && !(isProject && mixMode)) {
        setError(t("simulator.bulk.needField"));
        return;
      }
    }
    const ok = await confirm({
      title: t("simulator.bulk.applyTitle"),
      description:
        action === "reset"
          ? t("simulator.bulk.resetDescription", { count: count ?? 0 })
          : t("simulator.bulk.applyDescription", { count: count ?? 0 }),
      confirmLabel: t("simulator.bulk.apply"),
    });
    if (!ok) return;

    setApplying(true);
    try {
      const body: Parameters<typeof bulkEditLines>[1] = { filter: activeFilter };
      if (action === "set_overrides") {
        if (marginSet) body.margin_override = (parseFloat(marginPct) / 100).toFixed(4);
        if (applyMix) body.stock_purchase_mix_pct_override = mixPct;
        if (qtySet) body.quantity = normalizeIntegerQuantity(qty);
        if (paCoefSet) body.pa_coefficient_override = normalizePaCoefficient(paCoef);
        if (isProject && mixMode) body.force_manual_mix = mixMode === "manual";
      } else {
        body.reset = true;
      }
      await bulkEditLines(simId, body);
      onApplied();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("simulator.applyFailed"));
    } finally {
      setApplying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !applying && onClose()}>
      <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col gap-0 p-0 sm:max-w-4xl" showCloseButton={!applying}>
        <DialogHeader className="border-b border-border p-5">
          <DialogTitle>
            {selectionMode
              ? t("simulator.bulk.titleSelection", { count: lineIds!.length })
              : t("simulator.bulk.title")}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-5">
          {selectionMode ? (
            <p className="mb-4 text-sm text-muted-foreground">
              {t("simulator.bulk.selectionScope")}
            </p>
          ) : (
            <p className="mb-4 text-sm text-muted-foreground">
              {t("simulator.bulk.filterScope")}
            </p>
          )}

          <div className="mt-4 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
            {previewing ? (
              <span className="flex items-center gap-2">
                <CircleNotch size={13} className="animate-spin" /> {t("simulator.calculating")}
              </span>
            ) : (
              <span>
                <span className="font-bold text-accent-foreground">{count ?? 0}</span>
                {(count ?? 0) !== 1
                  ? t("simulator.bulk.impactSuffixOther")
                  : t("simulator.bulk.impactSuffixOne")}
              </span>
            )}
          </div>

          <h3 className="mb-3 mt-5 text-sm font-bold text-foreground">{t("simulator.bulk.action")}</h3>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["set_overrides", "simulator.bulk.setOverrides"],
                ["reset", "simulator.bulk.resetOverrides"],
              ] as [ActionType, MessageKey][]
            ).map(([id, key]) => (
              <button
                key={id}
                type="button"
                onClick={() => setAction(id)}
                className={cn(
                  "rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                  action === id
                    ? "border-primary bg-accent text-accent-foreground"
                    : "border-border text-muted-foreground hover:bg-muted"
                )}
              >
                {t(key)}
              </button>
            ))}
          </div>

          {action === "set_overrides" && (
            <div className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>{t("simulator.bulk.margin")}</label>
                  <input
                    type="number"
                    min={0}
                    max={99}
                    step="0.1"
                    value={marginPct}
                    onChange={(e) => setMarginPct(e.target.value)}
                    className={inputCls}
                    placeholder={t("simulator.bulk.leaveBlank")}
                  />
                </div>
                {isProject && (
                  <div>
                    <label className={labelCls}>{t("simulator.bulk.quantity")}</label>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={qty}
                      onChange={(e) => setQty(e.target.value)}
                      className={inputCls}
                      placeholder={t("simulator.bulk.leaveBlank")}
                    />
                  </div>
                )}
              </div>

              <div>
                <label className={labelCls}>{t("simulator.bulk.paCoef")}</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={paCoef}
                  onChange={(e) => setPaCoef(e.target.value)}
                  className={inputCls}
                  placeholder={t("simulator.bulk.leaveBlankExample")}
                />
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {t("simulator.bulk.coefHelp")}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="bulk-apply-mix"
                  checked={applyMix}
                  onCheckedChange={(v) => setApplyMix(v === true)}
                />
                <Label htmlFor="bulk-apply-mix" className="text-sm font-normal">
                  {t("simulator.bulk.editMix")}
                </Label>
              </div>
              {applyMix && (
                <StockPurchaseMixSlider value={mixPct} onChange={setMixPct} disabled={applying} />
              )}

              {isProject && (
                <div>
                  <label className={labelCls}>{t("simulator.bulk.mixMode")}</label>
                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        ["", "simulator.bulk.unchanged"],
                        ["auto", "simulator.bulk.autoMix"],
                        ["manual", "simulator.bulk.manualMix"],
                      ] as [MixMode, MessageKey][]
                    ).map(([mode, key]) => (
                      <button
                        key={mode || "unchanged"}
                        type="button"
                        onClick={() => setMixMode(mode)}
                        className={cn(
                          "rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
                          mixMode === mode
                            ? "border-primary bg-accent text-accent-foreground"
                            : "border-border text-muted-foreground hover:bg-muted",
                        )}
                      >
                        {t(key)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter className="border-t border-border p-5">
          <Button type="button" variant="outline" onClick={onClose} disabled={applying}>
            {t("common.cancel")}
          </Button>
          <Button type="button" onClick={() => void handleApply()} disabled={applying || previewing}>
            {applying ? (
              <>
                <CircleNotch size={14} className="animate-spin" />
                {t("simulator.applying")}
              </>
            ) : (
              t("simulator.bulk.apply")
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
