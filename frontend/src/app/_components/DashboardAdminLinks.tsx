"use client";

import Link from "next/link";
import useSWR from "swr";
import { ArrowsClockwise, Users, Warning } from "@phosphor-icons/react";
import type { IconProps } from "@phosphor-icons/react";
import {
  getQuarantineFacets,
  getSyncStatus,
  listUsers,
  type SyncLog,
} from "@/lib/api";
import { AppIconCircle } from "@/components/AppIcon";
import { StatusBadge } from "@/components/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { uiDateLocale } from "@/lib/i18n";
import { useUiTranslate } from "@/lib/use-ui-translate";
import { cn } from "@/lib/utils";

function formatSyncDateTime(value: string | null | undefined, locale: string): string | null {
  if (!value) return null;
  return new Date(value).toLocaleString(uiDateLocale(locale), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function syncDescription(
  syncStatus: Awaited<ReturnType<typeof getSyncStatus>> | undefined,
  running: boolean,
  t: ReturnType<typeof useUiTranslate>,
  locale: string,
): string {
  if (running && syncStatus?.running) {
    const started = formatSyncDateTime(syncStatus.running.started_at, locale);
    return started ? t("dashboard.syncStarted", { date: started }) : t("dashboard.syncInProgress");
  }
  const last = syncStatus?.last;
  if (!last) return t("dashboard.noSync");
  const at = formatSyncDateTime(last.completed_at ?? last.started_at, locale);
  return at ? t("dashboard.lastSyncAt", { date: at }) : t("dashboard.lastSync");
}

function syncStatusPresentation(status: SyncLog["status"], t: ReturnType<typeof useUiTranslate>) {
  const map = {
    success: { variant: "success" as const, label: t("dashboard.syncSuccess") },
    failed: { variant: "failed" as const, label: t("dashboard.syncFailed") },
    partial_failure: { variant: "warning" as const, label: t("dashboard.syncPartial") },
    running: { variant: "running" as const, label: t("dashboard.syncRunning") },
  };
  return map[status] ?? map.running;
}

interface AdminLinkRowProps {
  href: string;
  icon: React.ComponentType<IconProps>;
  tone: "primary" | "warm" | "blue" | "navy" | "muted";
  title: string;
  description: string;
  badge?: { label: string; variant: "success" | "failed" | "warning" | "running" | "info" | "draft" };
}

function AdminLinkRow({ href, icon, tone, title, description, badge }: AdminLinkRowProps) {
  return (
    <Link
      href={href}
      className={cn(
        "group flex items-center gap-3 rounded-lg border border-transparent px-3 py-3 transition-colors",
        "hover:border-border hover:bg-muted/40",
      )}
    >
      <AppIconCircle icon={icon} tone={tone} weight="duotone" size="md" className="shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      {badge && (
        <StatusBadge variant={badge.variant} className="shrink-0">
          {badge.label}
        </StatusBadge>
      )}
    </Link>
  );
}

export function DashboardAdminLinks() {
  const t = useUiTranslate();
  const { displayLanguage } = useAuth();
  const { data: syncStatus, isLoading: syncLoading } = useSWR("odoo-sync-status", getSyncStatus, {
    refreshInterval: 60_000,
  });
  const { data: quarantine, isLoading: quarantineLoading } = useSWR(
    "quarantine-facets",
    getQuarantineFacets,
  );
  const { data: users, isLoading: usersLoading } = useSWR("admin-users-list", listUsers);

  const loading = syncLoading || quarantineLoading || usersLoading;

  const running = Boolean(syncStatus?.running);
  const lastStatus = syncStatus?.running?.status ?? syncStatus?.last?.status;

  const syncBadge = running
    ? { label: t("dashboard.syncRunning"), variant: "running" as const }
    : lastStatus
      ? syncStatusPresentation(lastStatus, t)
      : undefined;

  const unresolved = quarantine?.unresolved ?? 0;
  const userCount = users?.length ?? 0;
  const activeUsers = users?.filter((u) => u.is_active).length ?? 0;

  if (loading) {
    return (
      <section className="rounded-xl border bg-card p-4 shadow-[var(--shadow-soft)]">
        <h2 className="mb-3 text-sm font-semibold text-foreground">{t("nav.admin")}</h2>
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border bg-card p-4 shadow-[var(--shadow-soft)]">
      <h2 className="mb-1 text-sm font-semibold text-foreground">{t("nav.admin")}</h2>
      <p className="mb-3 text-xs text-muted-foreground">{t("dashboard.adminTools")}</p>

      <div className="divide-y divide-border rounded-lg border bg-muted/20">
        <AdminLinkRow
          href="/admin/migration-quarantine"
          icon={Warning}
          tone="warm"
          title={t("nav.quarantine")}
          description={
            unresolved === 0
              ? t("dashboard.quarantineNone")
              : t(unresolved > 1 ? "dashboard.quarantineCountOther" : "dashboard.quarantineCountOne", {
                  count: unresolved,
                })
          }
          badge={
            unresolved > 0
              ? { label: String(unresolved), variant: "warning" }
              : undefined
          }
        />
        <AdminLinkRow
          href="/settings?tab=odoo"
          icon={ArrowsClockwise}
          tone="blue"
          title={t("dashboard.syncOdoo")}
          description={syncDescription(syncStatus, running, t, displayLanguage)}
          badge={syncBadge}
        />
        <AdminLinkRow
          href="/admin/users"
          icon={Users}
          tone="navy"
          title={t("nav.users")}
          description={
            userCount === 0
              ? t("dashboard.noAccounts")
              : `${t(userCount > 1 ? "dashboard.accountOther" : "dashboard.accountOne", { count: userCount })} · ${t(activeUsers > 1 ? "dashboard.activeOther" : "dashboard.activeOne", { count: activeUsers })}`
          }
          badge={
            userCount > 0
              ? { label: String(userCount), variant: "draft" }
              : undefined
          }
        />
      </div>
    </section>
  );
}
