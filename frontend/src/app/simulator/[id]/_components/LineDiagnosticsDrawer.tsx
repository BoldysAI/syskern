"use client";

import Link from "next/link";
import { Warning, CheckCircle, PencilSimple } from "@phosphor-icons/react";
import type { SimulationLine } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { diagnosticTextClass, lineDiagnostics, LINE_STATUS, productEditHref, type ProductEditFromSimulation } from "./sim-format";
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
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-h-[85vh] max-w-lg flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-border px-5 py-4">
          <DialogTitle>Diagnostic de calcul</DialogTitle>
          <DialogDescription className="truncate font-mono text-sm text-warm">
            {line.product_sku}
          </DialogDescription>
          <p className="truncate text-sm text-muted-foreground">
            {line.product_designation || line.product_name}
          </p>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-x-hidden overflow-y-auto px-5 py-4">
          <div className="flex items-center gap-2">
            <span className={cn("inline-flex rounded px-2 py-0.5 text-xs font-medium", st.badge)}>
              {st.label}
            </span>
          </div>

          {(incCtx?.sale_incoterm || incCtx?.purchase_incoterm) && (
            <section className="rounded-lg border border-border bg-muted px-3 py-2.5 text-sm text-foreground">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Incoterms au calcul
              </h3>
              <ul className="mt-1.5 space-y-1">
                {incCtx.sale_incoterm && (
                  <li>
                    Vente :{" "}
                    {formatIncotermDisplay(incCtx.sale_incoterm, incCtx.sale_incoterm_location)}
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
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-destructive">
                <Warning size={14} weight="fill" />
                Erreurs ({errors.length})
              </h3>
              <ul className="space-y-2">
                {errors.map((msg, i) => (
                  <li
                    key={`e-${i}`}
                    className={cn(
                      "rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive",
                      diagnosticTextClass,
                    )}
                  >
                    {msg}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {warnings.length > 0 && (
            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-warm">
                <Warning size={14} weight="fill" />
                Avertissements ({warnings.length})
              </h3>
              <ul className="space-y-2">
                {warnings.map((msg, i) => (
                  <li
                    key={`w-${i}`}
                    className={cn(
                      "rounded-lg border border-warm/30 bg-warm/10 px-3 py-2 text-sm text-foreground",
                      diagnosticTextClass,
                    )}
                  >
                    {msg}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {!hasIssues && (
            <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/10 px-3 py-3 text-sm text-foreground">
              <CheckCircle size={18} className="mt-0.5 shrink-0 text-primary" weight="fill" />
              <p>Aucune erreur ni avertissement sur cette ligne.</p>
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 px-5 py-3">
          <Link
            href={productEditHref(line.product_sku, [...errors, ...warnings], fromSimulation)}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <PencilSimple size={14} />
            Modifier le produit
          </Link>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
