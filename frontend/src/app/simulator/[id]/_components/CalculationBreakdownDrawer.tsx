"use client";

import { useState } from "react";
import useSWR from "swr";
import { Warning, ArrowLeft, ArrowRight, CaretRight } from "@phosphor-icons/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { SimulationLine } from "@/lib/api";
import { listTransportModes } from "@/lib/api";
import { transportModeLabelMap } from "@/lib/transport-modes";
import { cn } from "@/lib/utils";
import { decToPct, diagnosticTextClass, fmtEur, fmtPrice, formatBreakdownStepDetails, isStaleSaleMarginBreakdown, lineDiagnostics, mpStr, parseLineBreakdown, prChainSteps, stepModuleLabel, type BreakdownStep } from "./sim-format";
import { formatIncotermDisplay } from "@/lib/incoterms";
import { useAuth } from "@/contexts/AuthContext";
import { useUiTranslate } from "@/lib/use-ui-translate";
import type { MessageKey } from "@/lib/i18n";

interface Props {
  line: SimulationLine | null;
  open: boolean;
  onClose: () => void;
}

const STEPS: { id: "summary" | "purchase" | "pr" | "sale"; label: MessageKey }[] = [
  { id: "summary", label: "simulator.breakdown.summary" },
  { id: "purchase", label: "simulator.chain.pa" },
  { id: "pr", label: "simulator.chain.pr" },
  { id: "sale", label: "simulator.chain.pv" },
];

function StepBadge({ applied }: { applied: boolean }) {
  const t = useUiTranslate();
  return (
    <span
      className={cn(
        "inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        applied ? "border border-primary/20 bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
      )}
    >
      {applied ? t("simulator.breakdown.applied") : t("simulator.breakdown.ignored")}
    </span>
  );
}

function StepDetailBlock({
  step,
  transportLabels,
  locale,
}: {
  step: BreakdownStep;
  transportLabels: Record<string, string>;
  locale: string;
}) {
  const details = formatBreakdownStepDetails(step, { transportLabels, locale });
  if (details.length === 0) return null;
  return (
    <div className="mt-3 space-y-1.5 rounded-lg border border-border bg-muted px-3 py-2.5">
      {details.map((line, i) => (
        <p key={i} className={cn("text-sm leading-snug text-foreground", diagnosticTextClass)}>
          {line}
        </p>
      ))}
    </div>
  );
}

function ChainSteps({
  steps,
  chainLabel,
  transportLabels,
  locale,
}: {
  steps: BreakdownStep[];
  chainLabel: string;
  transportLabels: Record<string, string>;
  locale: string;
}) {
  const t = useUiTranslate();
  if (steps.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("simulator.breakdown.noSteps", { chain: chainLabel })}
      </p>
    );
  }

  return (
    <ol className="space-y-4">
      {steps.map((step, idx) => (
        <li
          key={`${step.module}-${step.order ?? idx}`}
          className="rounded-lg border border-border bg-card p-4"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
              {step.order ?? idx + 1}
            </span>
            <span className="text-sm font-semibold text-foreground">
              {stepModuleLabel(step, locale)}
            </span>
            <StepBadge applied={step.applied} />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <div className="rounded border border-border bg-card px-2 py-1">
              <span className="text-[10px] font-semibold uppercase text-muted-foreground">{t("simulator.breakdown.input")}</span>
              <p className="tabular-nums text-foreground">{fmtPrice(step.input_price)}</p>
            </div>
            <CaretRight size={16} className="shrink-0 text-muted-foreground/60" />
            <div className="rounded border border-warm/30 bg-warm/10/50 px-2 py-1">
              <span className="text-[10px] font-semibold uppercase text-warm">{t("simulator.breakdown.output")}</span>
              <p className="font-medium tabular-nums text-foreground">{fmtPrice(step.output_price)}</p>
            </div>
          </div>

          <StepDetailBlock step={step} transportLabels={transportLabels} locale={locale} />

          {step.warnings.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {step.warnings.map((w, i) => (
                <li
                  key={i}
                  className={cn(
                    "flex items-start gap-1.5 rounded border border-warm/30 bg-warm/10 px-2.5 py-2 text-sm text-foreground",
                    diagnosticTextClass,
                  )}
                >
                  <Warning size={14} className="mt-0.5 shrink-0" weight="fill" />
                  <span className={diagnosticTextClass}>{w}</span>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}

export function CalculationBreakdownDrawer({ line, open, onClose }: Props) {
  const t = useUiTranslate();
  const { displayLanguage } = useAuth();
  const [stepIdx, setStepIdx] = useState(0);
  const { data: transportModes } = useSWR(
    open ? "transport-modes-breakdown" : null,
    () => listTransportModes(true)
  );
  const transportLabels = transportModeLabelMap(transportModes ?? []);

  if (!line) return null;

  const breakdown = parseLineBreakdown(line);
  const { errors, warnings } = lineDiagnostics(line);
  const purchaseSteps = breakdown.purchase?.steps ?? [];
  const prSteps = prChainSteps(line, breakdown);
  const saleSteps = breakdown.sale?.steps ?? [];
  const mixPct = breakdown.mix_pct ?? line.effective_mix_pct ?? 0;
  const purchasePct = 100 - (mixPct ?? 0);
  const hasBreakdown = purchaseSteps.length > 0 || prSteps.length > 0 || saleSteps.length > 0;
  const staleSaleMargin = isStaleSaleMarginBreakdown(breakdown);
  const mpSnap = breakdown.market_params_snapshot ?? {};
  const incSnap = breakdown.incoterm_context ?? {};

  const currentStep = STEPS[stepIdx]?.id ?? "summary";

  const goPrev = () => setStepIdx((i) => Math.max(0, i - 1));
  const goNext = () => setStepIdx((i) => Math.min(STEPS.length - 1, i + 1));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setStepIdx(0);
          onClose();
        }
      }}
    >
      <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <div className="shrink-0 border-b border-border px-5 py-4">
          <DialogHeader className="gap-1 p-0">
            <DialogTitle>{t("simulator.breakdown.title")}</DialogTitle>
            <DialogDescription className="truncate font-mono text-sm text-warm">
              {line.product_sku}
            </DialogDescription>
            <p className="truncate text-sm text-muted-foreground">
              {line.product_designation || line.product_name}
            </p>
          </DialogHeader>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {STEPS.map((s, i) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setStepIdx(i)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                  i === stepIdx
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                )}
              >
                <span className="font-bold">{i + 1}</span>
                {t(s.label)}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-5 py-4">
            {staleSaleMargin && (
              <div className="mb-4 rounded-lg border border-warm/40 bg-warm/10 px-4 py-3 text-sm text-foreground">
                <p className={diagnosticTextClass}>
                  {t("simulator.breakdown.stale")}
                </p>
              </div>
            )}

            {errors.length > 0 && !hasBreakdown && (
              <div className="mb-4 max-h-[min(40vh,16rem)] space-y-2 overflow-y-auto overscroll-contain">
                {errors.map((msg, i) => (
                  <div
                    key={i}
                    className={cn(
                      "rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive",
                      diagnosticTextClass,
                    )}
                  >
                    {msg}
                  </div>
                ))}
              </div>
            )}

            {currentStep === "summary" && (
              <div className="space-y-4">
                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("simulator.breakdown.frozen")}
                  </h3>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <SummaryCell label={t("simulator.column.paNet")} value={fmtEur(line.pa_net_eur)} />
                    <SummaryCell label={t("simulator.module.pamp")} value={fmtEur(line.pamp_predictive_eur)} />
                    <SummaryCell label={t("simulator.column.pr")} value={fmtEur(line.pr_eur)} highlight />
                    <SummaryCell label={t("simulator.column.pv")} value={fmtEur(line.pv_eur)} highlight />
                    <SummaryCell
                      label={t("simulator.breakdown.syskernEffective")}
                      value={
                        line.effective_margin_rate
                          ? `${decToPct(line.effective_margin_rate)} %`
                          : "—"
                      }
                    />
                    <SummaryCell
                      label={t("simulator.breakdown.mixStock")}
                      value={t("simulator.breakdown.mixValue", { purchase: purchasePct, stock: mixPct })}
                    />
                  </div>
                </section>

                {Object.keys(mpSnap).length > 0 && (
                  <section className="rounded-lg border border-border bg-muted px-4 py-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t("simulator.market.usedAtCalc")}
                    </h3>
                    <ul className="mt-2 space-y-1 text-sm text-foreground">
                      <li>
                        {t("simulator.market.copperLine", {
                          base: mpStr(mpSnap, "copper_base_price_rmb"),
                          current: mpStr(mpSnap, "copper_current_price_rmb"),
                        })}
                      </li>
                      <li>
                        {t("simulator.fx.changeEurRmb")} : {mpStr(mpSnap, "fx_eur_rmb")}
                      </li>
                      <li>
                        {t("simulator.fx.changeEurUsd")} : {mpStr(mpSnap, "fx_eur_usd")}
                      </li>
                    </ul>
                  </section>
                )}

                {(incSnap.sale_incoterm || incSnap.purchase_incoterm) && (
                  <section className="rounded-lg border border-border bg-muted px-4 py-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t("simulator.diag.incoterms")}
                    </h3>
                    <ul className="mt-2 space-y-1 text-sm text-foreground">
                      {incSnap.sale_incoterm && (
                        <li>
                          {t("simulator.diag.sale")}{" "}
                          {formatIncotermDisplay(
                            String(incSnap.sale_incoterm),
                            incSnap.sale_incoterm_location as string | undefined
                          )}
                        </li>
                      )}
                      {incSnap.purchase_incoterm && (
                        <li>
                          {t("simulator.diag.purchaseActive")}{" "}
                          {formatIncotermDisplay(
                            String(incSnap.purchase_incoterm),
                            incSnap.purchase_incoterm_location as string | undefined
                          )}
                        </li>
                      )}
                    </ul>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t("simulator.breakdown.prExplain")}
                    </p>
                  </section>
                )}

                <section className="rounded-lg border border-border bg-muted px-4 py-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("simulator.breakdown.prFormulaTitle")}
                  </h3>
                  <p className="mt-2 text-sm text-foreground">
                    {t("simulator.breakdown.prFormulaDisplay", { purchase: purchasePct, stock: mixPct })}
                  </p>
                  <p className="mt-1 text-sm tabular-nums text-foreground">
                    = ({purchasePct / 100} × {line.pa_net_eur ?? "?"}) + ({mixPct / 100} ×{" "}
                    {line.pamp_predictive_eur ?? "?"})
                    {" → "}
                    <span className="font-semibold">{fmtEur(line.pr_eur)}</span>
                  </p>
                </section>

                {saleSteps.length > 0 && (
                  <section className="rounded-lg border border-border bg-muted px-4 py-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t("simulator.chain.pv")}
                    </h3>
                    <p className="mt-2 text-sm text-foreground">
                      {t("simulator.breakdown.applyOrder")}{" "}
                      {saleSteps.map((s) => stepModuleLabel(s, displayLanguage)).join(" → ")}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t("simulator.breakdown.syskernFixed")}
                    </p>
                    <p className="mt-2 text-sm tabular-nums text-foreground">
                      {t("simulator.breakdown.prPrefix", { value: fmtEur(line.pr_eur) })}
                      {saleSteps.map((s) => (
                        <span key={`${s.module}-${s.order}`}>
                          {" → "}
                          {stepModuleLabel(s, displayLanguage)} {fmtPrice(s.output_price)}
                        </span>
                      ))}
                      {" → "}
                      <span className="font-semibold">
                        {t("simulator.breakdown.pvPrefix", { value: fmtEur(line.pv_eur) })}
                      </span>
                    </p>
                  </section>
                )}

                {warnings.length > 0 && (
                  <section>
                    <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-warm">
                      <Warning size={14} weight="fill" />
                      {t("simulator.diag.warnings", { count: warnings.length })}
                    </h3>
                    <ul className="space-y-1.5">
                      {warnings.map((w, i) => (
                        <li
                          key={i}
                          className={cn(
                            "rounded-lg border border-warm/30 bg-warm/10 px-3 py-2 text-sm text-foreground",
                            diagnosticTextClass,
                          )}
                        >
                          {w}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </div>
            )}

            {currentStep === "purchase" && (
              <div>
                <p className="mb-4 text-sm text-muted-foreground">
                  {t("simulator.breakdown.purchaseIntro")}
                  {breakdown.purchase?.final_amount && (
                    <span className="ml-1 font-medium text-foreground">
                      {t("simulator.breakdown.result", {
                        price: fmtPrice({
                          amount: breakdown.purchase.final_amount,
                          currency: breakdown.purchase.final_currency ?? "EUR",
                        }),
                      })}
                    </span>
                  )}
                </p>
                <ChainSteps
                  steps={purchaseSteps}
                  chainLabel="PA"
                  transportLabels={transportLabels}
                  locale={displayLanguage}
                />
              </div>
            )}

            {currentStep === "pr" && (
              <div>
                <p className="mb-4 text-sm text-muted-foreground">
                  {t("simulator.breakdown.prIntro")}
                  {(breakdown.pr?.final_amount ?? line.pr_eur) && (
                    <span className="ml-1 font-medium text-foreground">
                      {t("simulator.breakdown.result", {
                        price: fmtPrice(
                          breakdown.pr?.final_amount
                            ? {
                                amount: breakdown.pr.final_amount,
                                currency: breakdown.pr.final_currency ?? "EUR",
                              }
                            : { amount: line.pr_eur!, currency: "EUR" },
                        ),
                      })}
                    </span>
                  )}
                </p>
                <ChainSteps
                  steps={prSteps}
                  chainLabel="PR"
                  transportLabels={transportLabels}
                  locale={displayLanguage}
                />
              </div>
            )}

            {currentStep === "sale" && (
              <div>
                <p className="mb-4 text-sm text-muted-foreground">
                  {t("simulator.breakdown.saleIntro")}
                  {breakdown.sale?.final_amount && (
                    <span className="ml-1 font-medium text-foreground">
                      {t("simulator.breakdown.result", {
                        price: fmtPrice({
                          amount: breakdown.sale.final_amount,
                          currency: breakdown.sale.final_currency ?? "EUR",
                        }),
                      })}
                    </span>
                  )}
                </p>
                <ChainSteps
                  steps={saleSteps}
                  chainLabel="PV"
                  transportLabels={transportLabels}
                  locale={displayLanguage}
                />
              </div>
            )}
          </div>

        <div className="flex shrink-0 items-center justify-between border-t border-border px-5 py-3">
          <Button type="button" variant="outline" size="sm" onClick={goPrev} disabled={stepIdx === 0} className="gap-1.5">
            <ArrowLeft size={14} />
            {t("simulator.wizard.previous")}
          </Button>
          <span className="text-xs text-muted-foreground">
            {t("simulator.breakdown.step", { current: stepIdx + 1, total: STEPS.length })}
          </span>
          <Button type="button" size="sm" onClick={goNext} disabled={stepIdx >= STEPS.length - 1} className="gap-1.5">
            {t("simulator.wizard.next")}
            <ArrowRight size={14} />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SummaryCell({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-0.5 text-sm tabular-nums",
          highlight ? "font-semibold text-foreground" : "text-foreground"
        )}
      >
        {value}
      </p>
    </div>
  );
}
