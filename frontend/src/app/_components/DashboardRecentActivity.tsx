"use client";

import Link from "next/link";
import { Clock, FileText } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { AppIcon } from "@/components/AppIcon";
import { useAuth } from "@/contexts/AuthContext";
import type { MessageKey } from "@/lib/i18n";
import { useUiTranslate } from "@/lib/use-ui-translate";
import { formatRelative } from "./dashboard-utils";

interface RecentSimulation {
  id: string;
  label: string;
  simulation_type: "tariff" | "project";
  status: "draft" | "finalized" | "archived";
  updated_at: string;
}

interface RecentOffer {
  id: string;
  label: string;
  offer_type: "tariff" | "project";
  status: string;
  created_at: string;
}

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

function ActivityListSkeleton() {
  return (
    <div className="space-y-4 pl-5">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-12 rounded-lg" />
      ))}
    </div>
  );
}

interface ActivityPanelProps {
  title: string;
  href: string;
  loading?: boolean;
  children: React.ReactNode;
}

function ActivityPanel({ title, href, loading, children }: ActivityPanelProps) {
  const t = useUiTranslate();
  return (
    <section className="rounded-xl border bg-card p-4 shadow-[var(--shadow-soft)]">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <Link href={href} className="text-xs font-medium text-primary hover:underline">
          {t("dashboard.seeAll")}
        </Link>
      </div>
      {loading ? <ActivityListSkeleton /> : children}
    </section>
  );
}

interface TimelineItemProps {
  href: string;
  title: string;
  meta: string;
  badgeLabel: string;
  badgeVariant: "default" | "info" | "success" | "warning" | "failed" | "draft";
  isLast?: boolean;
}

function TimelineItem({ href, title, meta, badgeLabel, badgeVariant, isLast }: TimelineItemProps) {
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      <div className="relative flex w-5 shrink-0 flex-col items-center">
        {!isLast && (
          <span
            className="absolute top-3 bottom-0 left-1/2 w-px -translate-x-1/2 bg-border"
            aria-hidden
          />
        )}
        <span
          className="relative z-10 mt-1.5 size-2 shrink-0 rounded-full bg-primary ring-4 ring-primary/15"
          aria-hidden
        />
      </div>
      <Link
        href={href}
        className={cn(
          "min-w-0 flex-1 rounded-lg border border-transparent px-3 py-2 transition-colors",
          "hover:border-border hover:bg-muted/40",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{title}</p>
            <p className="text-xs text-muted-foreground">{meta}</p>
          </div>
          <StatusBadge variant={badgeVariant} className="shrink-0">
            {badgeLabel}
          </StatusBadge>
        </div>
      </Link>
    </li>
  );
}

interface DashboardRecentActivityProps {
  simulations: RecentSimulation[];
  offers: RecentOffer[];
  loadingSims?: boolean;
  loadingOffers?: boolean;
}

export function DashboardRecentActivity({
  simulations,
  offers,
  loadingSims,
  loadingOffers,
}: DashboardRecentActivityProps) {
  const t = useUiTranslate();
  const { displayLanguage } = useAuth();
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ActivityPanel title={t("dashboard.latestSimulations")} href="/simulator" loading={loadingSims}>
        {simulations.length === 0 ? (
          <EmptyState
            icon={<AppIcon icon={Clock} weight="duotone" size="lg" />}
            title={t("dashboard.noSimulation")}
            description={t("dashboard.noSimulationDesc")}
            className="py-8"
          />
        ) : (
          <ul className="pl-0.5">
            {simulations.map((sim, index) => {
              const st = SIM_STATUS[sim.status] ?? SIM_STATUS.draft;
              return (
                <TimelineItem
                  key={sim.id}
                  href={`/simulator/${sim.id}`}
                  title={sim.label}
                  meta={`${sim.simulation_type === "project" ? t("common.project") : t("common.tariff")} · ${formatRelative(sim.updated_at, displayLanguage)}`}
                  badgeLabel={t(st.labelKey)}
                  badgeVariant={st.variant}
                  isLast={index === simulations.length - 1}
                />
              );
            })}
          </ul>
        )}
      </ActivityPanel>

      <ActivityPanel title={t("dashboard.latestOffers")} href="/offers" loading={loadingOffers}>
        {offers.length === 0 ? (
          <EmptyState
            icon={<AppIcon icon={FileText} weight="duotone" size="lg" />}
            title={t("dashboard.noOffer")}
            description={t("dashboard.noOfferDesc")}
            className="py-8"
          />
        ) : (
          <ul className="pl-0.5">
            {offers.map((offer, index) => {
              const st = OFFER_STATUS[offer.status];
              return (
                <TimelineItem
                  key={offer.id}
                  href={`/offers/${offer.id}`}
                  title={offer.label}
                  meta={`${offer.offer_type === "project" ? t("common.project") : t("common.tariff")} · ${formatRelative(offer.created_at, displayLanguage)}`}
                  badgeLabel={st ? t(st.labelKey) : offer.status}
                  badgeVariant={st?.variant ?? "default"}
                  isLast={index === offers.length - 1}
                />
              );
            })}
          </ul>
        )}
      </ActivityPanel>
    </div>
  );
}
