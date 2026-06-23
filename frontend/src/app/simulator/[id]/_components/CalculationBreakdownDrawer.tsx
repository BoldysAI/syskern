"use client";

import { useState } from "react";
import useSWR from "swr";
import * as Dialog from "@radix-ui/react-dialog";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  X,
} from "lucide-react";
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
        applied ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"
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
    <div className="mt-3 space-y-1.5 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5">
      {details.map((line, i) => (
        <p key={i} className="text-sm leading-snug text-slate-700">
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
      <p className="text-sm text-slate-500">
        Aucune étape enregistrée pour la chaîne {chainLabel}.
      </p>
    );
  }

  return (
    <ol className="space-y-4">
      {steps.map((step, idx) => (
        <li
          key={`${step.module}-${step.order ?? idx}`}
          className="rounded-lg border border-[#E2E8F0] bg-white p-4"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">
              {step.order ?? idx + 1}
            </span>
            <span className="text-sm font-semibold text-slate-800">
              {moduleLabel(step.module)}
            </span>
            <StepBadge applied={step.applied} />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <div className="rounded border border-slate-200 bg-white px-2 py-1">
              <span className="text-[10px] font-semibold uppercase text-slate-400">Entrée</span>
              <p className="tabular-nums text-slate-700">{fmtPrice(step.input_price)}</p>
            </div>
            <ChevronRight size={16} className="shrink-0 text-slate-300" />
            <div className="rounded border border-orange-100 bg-orange-50/50 px-2 py-1">
              <span className="text-[10px] font-semibold uppercase text-orange-600">Sortie</span>
              <p className="font-medium tabular-nums text-slate-900">{fmtPrice(step.output_price)}</p>
            </div>
          </div>

          <StepDetailBlock step={step} transportLabels={transportLabels} />

          {step.warnings.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {step.warnings.map((w, i) => (
                <li
                  key={i}
                  className="flex items-start gap-1.5 rounded border border-amber-100 bg-amber-50 px-2.5 py-2 text-sm text-amber-900"
                >
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
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
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setStepIdx(0);
          onClose();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-[#E2E8F0] bg-white shadow-xl">
          <div className="shrink-0 border-b border-[#E2E8F0] px-5 py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <Dialog.Title className="text-base font-semibold text-slate-900">
                  Détail du calcul
                </Dialog.Title>
                <Dialog.Description className="mt-1 truncate font-mono text-sm text-orange-600">
                  {line.product_sku}
                </Dialog.Description>
                <p className="mt-0.5 truncate text-sm text-slate-500">
                  {line.product_designation || line.product_name}
                </p>
              </div>
              <Dialog.Close className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                <X size={18} />
              </Dialog.Close>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {STEPS.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setStepIdx(i)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                    i === stepIdx
                      ? "bg-[#E07200] text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
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
                    className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-800"
                  >
                    {msg}
                  </div>
                ))}
              </div>
            )}

            {currentStep === "summary" && (
              <div className="space-y-4">
                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
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
                  <section className="rounded-lg border border-[#E2E8F0] bg-slate-50 px-4 py-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Paramètres marché utilisés au calcul
                    </h3>
                    <ul className="mt-2 space-y-1 text-sm text-slate-700">
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
                  <section className="rounded-lg border border-[#E2E8F0] bg-slate-50 px-4 py-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Incoterms au calcul
                    </h3>
                    <ul className="mt-2 space-y-1 text-sm text-slate-700">
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
                    <p className="mt-2 text-xs text-slate-500">
                      Le PR ne dépend pas directement de l&apos;incoterm — il combine PA net et
                      PAMP via le mix. L&apos;incoterm achat contextualise la chaîne PA ; l&apos;incoterm
                      vente la chaîne PV.
                    </p>
                  </section>
                )}

                <section className="rounded-lg border border-[#E2E8F0] bg-slate-50 px-4 py-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Formule PR
                  </h3>
                  <p className="mt-2 text-sm text-slate-700">
                    PR = ({purchasePct} % × PA net) + ({mixPct} % × PAMP prév.)
                  </p>
                  <p className="mt-1 text-sm tabular-nums text-slate-800">
                    = ({purchasePct / 100} × {line.pa_net_eur ?? "?"}) + ({mixPct / 100} ×{" "}
                    {line.pamp_predictive_eur ?? "?"})
                    {" → "}
                    <span className="font-semibold">{fmtEur(line.pr_eur)}</span>
                  </p>
                </section>

                {warnings.length > 0 && (
                  <section>
                    <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-600">
                      <AlertTriangle size={14} />
                      Avertissements ({warnings.length})
                    </h3>
                    <ul className="space-y-1.5">
                      {warnings.map((w, i) => (
                        <li
                          key={i}
                          className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-900"
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
                <p className="mb-4 text-sm text-slate-600">
                  Chaîne d&apos;achat : du prix PO fournisseur au PA net en EUR.
                  {breakdown.purchase?.final_amount && (
                    <span className="ml-1 font-medium text-slate-800">
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
                <p className="mb-4 text-sm text-slate-600">
                  Chaîne de vente : du PR au PV final en EUR.
                  {breakdown.sale?.final_amount && (
                    <span className="ml-1 font-medium text-slate-800">
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

          <div className="flex shrink-0 items-center justify-between border-t border-[#E2E8F0] px-5 py-3">
            <button
              type="button"
              onClick={goPrev}
              disabled={stepIdx === 0}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-40"
            >
              <ArrowLeft size={14} />
              Précédent
            </button>
            <span className="text-xs text-slate-400">
              Étape {stepIdx + 1} / {STEPS.length}
            </span>
            <button
              type="button"
              onClick={goNext}
              disabled={stepIdx >= STEPS.length - 1}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#E07200] px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-[#C56400] disabled:opacity-40"
            >
              Suivant
              <ArrowRight size={14} />
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
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
    <div className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p
        className={cn(
          "mt-0.5 text-sm tabular-nums",
          highlight ? "font-semibold text-slate-900" : "text-slate-700"
        )}
      >
        {value}
      </p>
    </div>
  );
}
