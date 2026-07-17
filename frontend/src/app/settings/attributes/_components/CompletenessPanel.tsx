"use client";

import useSWR from "swr";
import { getAttributeCompleteness, type CompletenessField } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** SWR key shared with the dashboard widget (same endpoint, one cache entry). */
export const COMPLETENESS_KEY = "attribute-completeness";

function barColor(pct: number): string {
  if (pct < 40) return "bg-destructive";
  if (pct < 75) return "bg-warm";
  return "bg-primary";
}

/**
 * Catalog completeness table (FEEDBACK 1): fill rate per field over active
 * products — core columns + dynamic attributes, least-complete first.
 */
export default function CompletenessPanel() {
  const { data, isLoading, error } = useSWR(COMPLETENESS_KEY, getAttributeCompleteness);

  return (
    <section className="mt-8" id="completude">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-foreground">Complétude du catalogue</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Taux de remplissage par champ sur les produits actifs — champs cœur et attributs
            dynamiques, du moins complet au plus complet.
          </p>
        </div>
        {data && data.total_products > 0 ? (
          <div className="text-right">
            <div className="text-2xl font-bold tabular-nums text-foreground">
              {data.average_percent}%
            </div>
            <div className="text-xs text-muted-foreground">
              moyenne · {data.total_products} produits
            </div>
          </div>
        ) : null}
      </div>

      <Card className="overflow-hidden py-0">
        {error ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            Impossible de charger la complétude.
          </div>
        ) : isLoading || !data ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Chargement…</div>
        ) : data.total_products === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            Aucun produit actif dans le catalogue.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-border bg-muted/50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Champ
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Complétude
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Manquants
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.fields.map((f) => (
                  <CompletenessRow key={f.key} field={f} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </section>
  );
}

function CompletenessRow({ field }: { field: CompletenessField }) {
  return (
    <tr className="hover:bg-muted/30">
      <td className="px-4 py-2.5">
        <span className="text-sm text-foreground">{field.label}</span>
        {field.kind === "attribute" ? (
          <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            attribut
          </span>
        ) : null}
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-32 overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full", barColor(field.percent))}
              style={{ width: `${field.percent}%` }}
            />
          </div>
          <span className="w-12 text-sm font-medium tabular-nums text-foreground">
            {field.percent}%
          </span>
        </div>
      </td>
      <td className="px-4 py-2.5 text-right text-sm tabular-nums text-muted-foreground">
        {field.missing}
      </td>
    </tr>
  );
}
