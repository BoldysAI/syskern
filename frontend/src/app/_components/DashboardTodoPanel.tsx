"use client";

import Link from "next/link";
import {
  Calculator,
  Clock,
  Warning,
  WarningCircle,
} from "@phosphor-icons/react";
import type { DashboardTodoItem, DashboardTodoKind } from "@/lib/api";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { formatRelative } from "./dashboard-utils";

const KIND_CONFIG: Record<
  DashboardTodoKind,
  { label: string; icon: typeof Warning; className: string }
> = {
  simulation_dirty: {
    label: "Recalcul nécessaire",
    icon: Warning,
    className: "text-warm bg-warm/10",
  },
  simulation_never_calculated: {
    label: "Jamais calculée",
    icon: Clock,
    className: "text-amber-700 bg-amber-50",
  },
  simulation_line_errors: {
    label: "Erreurs de calcul",
    icon: WarningCircle,
    className: "text-destructive bg-destructive/10",
  },
  offer_expiring: {
    label: "Expire bientôt",
    icon: Clock,
    className: "text-violet-700 bg-violet-50",
  },
  offer_generation_error: {
    label: "Génération échouée",
    icon: WarningCircle,
    className: "text-destructive bg-destructive/10",
  },
};

interface Props {
  items: DashboardTodoItem[];
  loading?: boolean;
}

export function DashboardTodoPanel({ items, loading }: Props) {
  if (loading) {
    return (
      <section className="rounded-xl border bg-card p-4 shadow-[var(--shadow-soft)]">
        <h2 className="mb-3 text-sm font-semibold text-foreground">À traiter</h2>
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border bg-card p-4 shadow-[var(--shadow-soft)]">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">À traiter</h2>
        {items.length > 0 && (
          <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/simulator?is_dirty=true" />}>
            Simulations à recalculer
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <EmptyState
          className="border-none bg-transparent py-6 shadow-none"
          icon={<Calculator size={28} weight="duotone" />}
          title="Rien en attente"
          description="Toutes vos simulations et offres sont à jour."
        />
      ) : (
        <ul className="space-y-2">
          {items.map((item) => {
            const cfg = KIND_CONFIG[item.kind];
            const Icon = cfg.icon;
            return (
              <li key={`${item.kind}-${item.id}`}>
                <Link
                  href={item.href_path}
                  className="flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 transition-colors hover:border-border hover:bg-muted/40"
                >
                  <span
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                      cfg.className,
                    )}
                  >
                    <Icon size={18} weight="duotone" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {item.label}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {cfg.label} · {formatRelative(item.occurred_at)}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
