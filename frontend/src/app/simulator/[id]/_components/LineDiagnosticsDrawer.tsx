"use client";

import * as Dialog from "@radix-ui/react-dialog";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Pencil, X } from "lucide-react";
import type { SimulationLine } from "@/lib/api";
import { cn } from "@/lib/utils";
import { lineDiagnostics, LINE_STATUS, productEditHref, type ProductEditFromSimulation } from "./sim-format";
import { formatIncotermDisplay } from "@/lib/incoterms";

interface Props {
  line: SimulationLine | null;
  fromSimulation?: ProductEditFromSimulation;
  open: boolean;
  onClose: () => void;
}

export function LineDiagnosticsDrawer({ line, fromSimulation, open, onClose }: Props) {
  if (!line) return null;

  const st = LINE_STATUS[line.status] ?? LINE_STATUS.pending;
  const { errors, warnings } = lineDiagnostics(line);
  const hasIssues = errors.length > 0 || warnings.length > 0;
  const incCtx = (
    (line.calculation_breakdown ?? {}) as {
      incoterm_context?: {
        sale_incoterm?: string;
        sale_incoterm_location?: string;
        purchase_incoterm?: string;
        purchase_incoterm_location?: string;
      };
    }
  ).incoterm_context;

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-[#E2E8F0] bg-white shadow-xl">
          <div className="flex items-start justify-between border-b border-[#E2E8F0] px-5 py-4">
            <div className="min-w-0 pr-4">
              <Dialog.Title className="text-base font-semibold text-slate-900">
                Diagnostic de calcul
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

          <div className="max-h-[60vh] space-y-4 overflow-y-auto px-5 py-4">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "inline-flex rounded px-2 py-0.5 text-xs font-medium",
                  st.badge
                )}
              >
                {st.label}
              </span>
            </div>

            {(incCtx?.sale_incoterm || incCtx?.purchase_incoterm) && (
              <section className="rounded-lg border border-[#E2E8F0] bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Incoterms au calcul
                </h3>
                <ul className="mt-1.5 space-y-1">
                  {incCtx.sale_incoterm && (
                    <li>
                      Vente :{" "}
                      {formatIncotermDisplay(
                        incCtx.sale_incoterm,
                        incCtx.sale_incoterm_location
                      )}
                    </li>
                  )}
                  {incCtx.purchase_incoterm && (
                    <li>
                      Achat :{" "}
                      {formatIncotermDisplay(
                        incCtx.purchase_incoterm,
                        incCtx.purchase_incoterm_location
                      )}
                    </li>
                  )}
                </ul>
              </section>
            )}

            {errors.length > 0 && (
              <section>
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-red-600">
                  <AlertTriangle size={14} />
                  Erreurs ({errors.length})
                </h3>
                <ul className="space-y-2">
                  {errors.map((msg, i) => (
                    <li
                      key={`e-${i}`}
                      className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-800"
                    >
                      {msg}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {warnings.length > 0 && (
              <section>
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-600">
                  <AlertTriangle size={14} />
                  Avertissements ({warnings.length})
                </h3>
                <ul className="space-y-2">
                  {warnings.map((msg, i) => (
                    <li
                      key={`w-${i}`}
                      className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-900"
                    >
                      {msg}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {!hasIssues && (
              <div className="flex items-start gap-2 rounded-lg border border-green-100 bg-green-50 px-3 py-3 text-sm text-green-800">
                <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
                <p>Aucune erreur ni avertissement sur cette ligne.</p>
              </div>
            )}
          </div>

          <div className="flex justify-end border-t border-[#E2E8F0] px-5 py-3">
            <Link
              href={productEditHref(line.product_sku, [...errors, ...warnings], fromSimulation)}
              className="inline-flex items-center gap-2 rounded-lg bg-[#E07200] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#C56400]"
            >
              <Pencil size={14} />
              Modifier le produit
            </Link>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
