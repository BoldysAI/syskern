"use client";

import Link from "next/link";
import { ChartLineUp, FileText, GitDiff } from "@phosphor-icons/react";
import type { DashboardRecentItem } from "@/lib/api";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { useAuth } from "@/contexts/AuthContext";
import type { MessageKey } from "@/lib/i18n";
import { useUiTranslate } from "@/lib/use-ui-translate";
import { formatRelative } from "./dashboard-utils";

const OFFER_STATUS: Record<string, { labelKey: MessageKey; variant: "default" | "info" | "success" | "warning" | "failed" | "draft" }> = {
  draft: { labelKey: "dashboard.statusDraft", variant: "draft" },
  sent: { labelKey: "dashboard.statusSent", variant: "info" },
  won: { labelKey: "dashboard.statusWon", variant: "success" },
  lost: { labelKey: "dashboard.statusLost", variant: "failed" },
  expired: { labelKey: "dashboard.statusExpired", variant: "warning" },
};

const SIM_STATUS: Record<string, { labelKey: MessageKey; variant: "default" | "info" | "success" | "warning" | "failed" | "draft" }> = {
  draft: { labelKey: "dashboard.statusDraft", variant: "warning" },
  finalized: { labelKey: "dashboard.statusFinalized", variant: "success" },
  archived: { labelKey: "dashboard.statusArchived", variant: "draft" },
};

function kindIcon(kind: DashboardRecentItem["kind"]) {
  switch (kind) {
    case "simulation":
      return ChartLineUp;
    case "offer":
      return FileText;
    case "comparison":
      return GitDiff;
  }
}

function kindLabel(kind: DashboardRecentItem["kind"], t: (key: MessageKey) => string) {
  switch (kind) {
    case "simulation":
      return t("nav.simulation");
    case "offer":
      return t("nav.offer");
    case "comparison":
      return t("nav.comparison");
  }
}

interface Props {
  items: DashboardRecentItem[];
  loading?: boolean;
}

export function DashboardActivityTimeline({ items, loading }: Props) {
  const t = useUiTranslate();
  const { displayLanguage } = useAuth();
  if (loading) {
    return (
      <section className="rounded-xl border bg-card p-4 shadow-[var(--shadow-soft)]">
        <h2 className="mb-3 text-sm font-semibold text-foreground">{t("dashboard.recentActivity")}</h2>
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border bg-card p-4 shadow-[var(--shadow-soft)]">
      <h2 className="mb-3 text-sm font-semibold text-foreground">{t("dashboard.recentActivity")}</h2>

      {items.length === 0 ? (
        <EmptyState
          className="border-none bg-transparent py-8 shadow-none"
          icon={<ChartLineUp size={28} weight="duotone" />}
          title={t("dashboard.noRecentActivity")}
          description={t("dashboard.noRecentActivityDesc")}
        />
      ) : (
        <ul className="pl-0.5">
          {items.map((item, index) => {
            const Icon = kindIcon(item.kind);
            const st =
              item.kind === "simulation"
                ? (SIM_STATUS[item.status] ?? SIM_STATUS.draft)
                : item.kind === "offer"
                  ? OFFER_STATUS[item.status]
                  : undefined;
            const isLast = index === items.length - 1;

            return (
              <li key={`${item.kind}-${item.id}`} className="relative flex gap-3 pb-4 last:pb-0">
                <div className="relative flex w-5 shrink-0 flex-col items-center">
                  {!isLast && (
                    <span
                      className="absolute top-3 bottom-0 left-1/2 w-px -translate-x-1/2 bg-border"
                      aria-hidden
                    />
                  )}
                  <span
                    className={cn(
                      "relative z-10 mt-1.5 size-2 shrink-0 rounded-full ring-4",
                      item.is_dirty ? "bg-warm ring-warm/20" : "bg-primary ring-primary/15",
                    )}
                    aria-hidden
                  />
                </div>
                <Link
                  href={item.href_path}
                  className="min-w-0 flex-1 rounded-lg border border-transparent px-3 py-2 transition-colors hover:border-border hover:bg-muted/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="mb-0.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        <Icon size={12} weight="duotone" />
                        {kindLabel(item.kind, t)}
                      </div>
                      <p className="truncate text-sm font-medium text-foreground">{item.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatRelative(item.occurred_at, displayLanguage)}
                        {item.is_dirty && (
                          <span className="ml-1.5 font-medium text-warm">{t("dashboard.needsRecalc")}</span>
                        )}
                      </p>
                    </div>
                    {st ? (
                      <StatusBadge variant={st.variant} className="shrink-0">
                        {t(st.labelKey)}
                      </StatusBadge>
                    ) : item.kind === "offer" ? (
                      <StatusBadge variant="default" className="shrink-0">
                        {item.status}
                      </StatusBadge>
                    ) : null}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
