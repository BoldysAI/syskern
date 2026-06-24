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
import { decToPct, fmtEur, fmtPrice, formatBreakdownStepDetails, lineDiagnostics, moduleLabel, mpStr, parseLineBreakdown, type BreakdownStep } from "./sim-format";
import { formatIncotermDisplay } from "@/lib/incoterms";

interface Props {
  line: SimulationLine | null;
  open: boolean;
  onClose: () => void;
}

const STEPS = [
  { id: "summary", label: "Synthèse" },
  { id: "purchase", label: "Chaîne PA" },
  { id: "sale", label: "Chaîne PV" },
] as const;

function StepBadge({ applied }: { applied: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        applied ? "border border-primary/20 bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
      )}
    >
      {applied ? "Appliqué" : "Ignoré"}
    </span>
  );
}

function StepDetailBlock({
  step,
  transportLabels,
}: {
  step: BreakdownStep;
  transportLabels: Record<string, string>;
}) {
  const details = formatBreakdownStepDetails(step, { transportLabels });
  if (details.length === 0) return null;
  return (
    <div className="mt-3 space-y-1.5 rounded-lg border border-border bg-muted px-3 py-2.5">
      {details.map((line, i) => (
        <p key={i} className="text-sm leading-snug text-foreground">
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
}: {
  steps: BreakdownStep[];
  chainLabel: string;
  transportLabels: Record<string, string>;
}) {
  if (steps.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Aucune étape enregistrée pour la chaîne {chainLabel}.
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
              {moduleLabel(step.module)}
            </span>
            <StepBadge applied={step.applied} />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <div className="rounded border border-border bg-card px-2 py-1">
              <span className="text-[10px] font-semibold uppercase text-muted-foreground">Entrée</span>
              <p className="tabular-nums text-foreground">{fmtPrice(step.input_price)}</p>
            </div>
            <CaretRight size={16} className="shrink-0 text-muted-foreground/60" />
            <div className="rounded border border-warm/30 bg-warm/10/50 px-2 py-1">
              <span className="text-[10px] font-semibold uppercase text-warm">Sortie</span>
              <p className="font-medium tabular-nums text-foreground">{fmtPrice(step.output_price)}</p>
            </div>
          </div>

          <StepDetailBlock step={step} transportLabels={transportLabels} />

          {step.warnings.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {step.warnings.map((w, i) => (
                <li
                  key={i}
                  className="flex items-start gap-1.5 rounded border border-warm/30 bg-warm/10 px-2.5 py-2 text-sm text-foreground"
                >
                  <Warning size={14} className="mt-0.5 shrink-0" weight="fill" />
                  {w}
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
  const saleSteps = breakdown.sale?.steps ?? [];
  const mixPct = breakdown.mix_pct ?? line.effective_mix_pct ?? 0;
  const purchasePct = 100 - (mixPct ?? 0);
  const hasBreakdown = purchaseSteps.length > 0 || saleSteps.length > 0;
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
      <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col gap-0 p-0 sm:max-w-4xl">
        <div className="shrink-0 border-b border-border px-5 py-4">
          <DialogHeader className="gap-1 p-0">
            <DialogTitle>Détail du calcul</DialogTitle>
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
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {errors.length > 0 && !hasBreakdown && (
              <div className="mb-4 space-y-2">
                {errors.map((msg, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive"
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
                    Résultats figés
                  </h3>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <SummaryCell label="PA net" value={fmtEur(line.pa_net_eur)} />
                    <SummaryCell label="PAMP prévisionnel" value={fmtEur(line.pamp_predictive_eur)} />
                    <SummaryCell label="PR" value={fmtEur(line.pr_eur)} highlight />
                    <SummaryCell label="PV" value={fmtEur(line.pv_eur)} highlight />
                    <SummaryCell
                      label="Marge Syskern eff."
                      value={
                        line.effective_margin_rate
                          ? `${decToPct(line.effective_margin_rate)} %`
                          : "—"
                      }
                    />
                    <SummaryCell
                      label="Mix stock / achat"
                      value={`${purchasePct} % achat · ${mixPct} % stock`}
                    />
                  </div>
                </section>

                {Object.keys(mpSnap).length > 0 && (
                  <section className="rounded-lg border border-border bg-muted px-4 py-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Paramètres marché utilisés au calcul
                    </h3>
                    <ul className="mt-2 space-y-1 text-sm text-foreground">
                      <li>
                        Cuivre base / actuel : {mpStr(mpSnap, "copper_base_price_rmb")} /{" "}
                        {mpStr(mpSnap, "copper_current_price_rmb")} RMB
                      </li>
                      <li>Change EUR→RMB : {mpStr(mpSnap, "fx_eur_rmb")}</li>
                      <li>Change EUR→USD : {mpStr(mpSnap, "fx_eur_usd")}</li>
                    </ul>
                  </section>
                )}

                {(incSnap.sale_incoterm || incSnap.purchase_incoterm) && (
                  <section className="rounded-lg border border-border bg-muted px-4 py-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Incoterms au calcul
                    </h3>
                    <ul className="mt-2 space-y-1 text-sm text-foreground">
                      {incSnap.sale_incoterm && (
                        <li>
                          Vente :{" "}
                          {formatIncotermDisplay(
                            String(incSnap.sale_incoterm),
                            incSnap.sale_incoterm_location as string | undefined
                          )}
                        </li>
                      )}
                      {incSnap.purchase_incoterm && (
                        <li>
                          Achat (fournisseur actif) :{" "}
                          {formatIncotermDisplay(
                            String(incSnap.purchase_incoterm),
                            incSnap.purchase_incoterm_location as string | undefined
                          )}
                        </li>
                      )}
                    </ul>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Le PR ne dépend pas directement de l&apos;incoterm — il combine PA net et
                      PAMP via le mix. L&apos;incoterm achat contextualise la chaîne PA ; l&apos;incoterm
                      vente la chaîne PV.
                    </p>
                  </section>
                )}

                <section className="rounded-lg border border-border bg-muted px-4 py-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Formule PR
                  </h3>
                  <p className="mt-2 text-sm text-foreground">
                    PR = ({purchasePct} % × PA net) + ({mixPct} % × PAMP prév.)
                  </p>
                  <p className="mt-1 text-sm tabular-nums text-foreground">
                    = ({purchasePct / 100} × {line.pa_net_eur ?? "?"}) + ({mixPct / 100} ×{" "}
                    {line.pamp_predictive_eur ?? "?"})
                    {" → "}
                    <span className="font-semibold">{fmtEur(line.pr_eur)}</span>
                  </p>
                </section>

                {warnings.length > 0 && (
                  <section>
                    <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-warm">
                      <Warning size={14} weight="fill" />
                      Avertissements ({warnings.length})
                    </h3>
                    <ul className="space-y-1.5">
                      {warnings.map((w, i) => (
                        <li
                          key={i}
                          className="rounded-lg border border-warm/30 bg-warm/10 px-3 py-2 text-sm text-foreground"
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
                  Chaîne d&apos;achat : du prix PO fournisseur au PA net en EUR.
                  {breakdown.purchase?.final_amount && (
                    <span className="ml-1 font-medium text-foreground">
                      Résultat :{" "}
                      {fmtPrice({
                        amount: breakdown.purchase.final_amount,
                        currency: breakdown.purchase.final_currency ?? "EUR",
                      })}
                    </span>
                  )}
                </p>
                <ChainSteps steps={purchaseSteps} chainLabel="PA" transportLabels={transportLabels} />
              </div>
            )}

            {currentStep === "sale" && (
              <div>
                <p className="mb-4 text-sm text-muted-foreground">
                  Chaîne de vente : du PR au PV final en EUR.
                  {breakdown.sale?.final_amount && (
                    <span className="ml-1 font-medium text-foreground">
                      Résultat :{" "}
                      {fmtPrice({
                        amount: breakdown.sale.final_amount,
                        currency: breakdown.sale.final_currency ?? "EUR",
                      })}
                    </span>
                  )}
                </p>
                <ChainSteps steps={saleSteps} chainLabel="PV" transportLabels={transportLabels} />
              </div>
            )}
          </div>

        <div className="flex shrink-0 items-center justify-between border-t border-border px-5 py-3">
          <Button type="button" variant="outline" size="sm" onClick={goPrev} disabled={stepIdx === 0} className="gap-1.5">
            <ArrowLeft size={14} />
            Précédent
          </Button>
          <span className="text-xs text-muted-foreground">
            Étape {stepIdx + 1} / {STEPS.length}
          </span>
          <Button type="button" size="sm" onClick={goNext} disabled={stepIdx >= STEPS.length - 1} className="gap-1.5">
            Suivant
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
