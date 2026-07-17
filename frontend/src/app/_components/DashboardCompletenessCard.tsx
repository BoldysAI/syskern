"use client";

import Link from "next/link";
import useSWR from "swr";
import { ArrowRight, ClipboardText } from "@phosphor-icons/react";
import { getAttributeCompleteness } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { isAdmin } from "@/lib/auth";
import { AppIcon } from "@/components/AppIcon";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

function barColor(pct: number): string {
  if (pct < 40) return "bg-destructive";
  if (pct < 75) return "bg-warm";
  return "bg-primary";
}

/**
 * Dashboard completeness widget (FEEDBACK 1): global catalog fill-rate average +
 * the least-complete fields, linking to the detail table on /settings/attributes.
 */
export function DashboardCompletenessCard() {
  const { user } = useAuth();
  const { data, isLoading } = useSWR("attribute-completeness", getAttributeCompleteness);
  const userIsAdmin = isAdmin(user?.role);

  // Nothing to show on an empty catalog.
  if (!isLoading && (!data || data.total_products === 0)) return null;

  const worst = data ? data.fields.filter((f) => f.percent < 100).slice(0, 5) : [];

  return (
    <section>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Complétude du catalogue
      </h2>
      <Card className="p-4">
        {isLoading || !data ? (
          <div className="py-6 text-center text-sm text-muted-foreground">Chargement…</div>
        ) : (
          <>
            <div className="flex items-start justify-between">
              <div>
                <div className="text-3xl font-bold tabular-nums text-foreground">
                  {data.average_percent}%
                </div>
                <div className="text-xs text-muted-foreground">
                  moyenne · {data.total_products.toLocaleString("fr-FR")} produits
                </div>
              </div>
              <AppIcon icon={ClipboardText} size="xl" className="text-muted-foreground/30" />
            </div>

            {worst.length > 0 ? (
              <div className="mt-4 space-y-2">
                <div className="text-xs font-medium text-muted-foreground">
                  Champs les moins complets
                </div>
                {worst.map((f) => (
                  <div key={f.key} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                      {f.label}
                    </span>
                    <div className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn("h-full rounded-full", barColor(f.percent))}
                        style={{ width: `${f.percent}%` }}
                      />
                    </div>
                    <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                      {f.percent}%
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">
                Tous les champs suivis sont complets. 🎉
              </p>
            )}

            {userIsAdmin ? (
              <Link
                href="/settings/attributes#completude"
                className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                Voir le détail par champ
                <AppIcon icon={ArrowRight} size="sm" />
              </Link>
            ) : null}
          </>
        )}
      </Card>
    </section>
  );
}
