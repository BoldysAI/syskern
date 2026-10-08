"use client";

import { useMemo } from "react";
import useSWR from "swr";
import {
  Books,
  ChartLineUp,
  Columns,
  FilePlus,
  GitDiff,
  Plus,
  SquaresFour,
} from "@phosphor-icons/react";
import { getDashboardSummary } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { canEdit, isAdmin } from "@/lib/auth";
import { fmtEur } from "@/app/simulator/[id]/_components/sim-format";
import { PageHeader } from "@/components/PageHeader";
import { DashboardKpiGrid } from "@/app/_components/DashboardKpiGrid";
import { DashboardQuickActions } from "@/app/_components/DashboardQuickActions";
import { DashboardTodoPanel } from "@/app/_components/DashboardTodoPanel";
import { DashboardMarketCard } from "@/app/_components/DashboardMarketCard";
import { DashboardActivityTimeline } from "@/app/_components/DashboardActivityTimeline";
import { DashboardResumeCard } from "@/app/_components/DashboardResumeCard";
import { DashboardOnboarding } from "@/app/_components/DashboardOnboarding";
import { DashboardAdminLinks } from "@/app/_components/DashboardAdminLinks";
import { DashboardCompletenessCard } from "@/app/_components/DashboardCompletenessCard";
import { useUiTranslate } from "@/lib/use-ui-translate";

export default function HomePage() {
  const { user } = useAuth();
  const t = useUiTranslate();
  const userCanEdit = canEdit(user?.role);
  const userIsAdmin = isAdmin(user?.role);

  const { data, isLoading } = useSWR("dashboard-summary", getDashboardSummary);

  const greeting = useMemo(() => {
    const name = user?.first_name?.trim();
    return name ? t("dashboard.greetingName", { name }) : t("dashboard.greeting");
  }, [user?.first_name, t]);

  const subtitle = useMemo(() => {
    if (!data) return t("dashboard.subtitleOverview");
    if (data.todo.length > 0) {
      return t(data.todo.length > 1 ? "dashboard.todoCountOther" : "dashboard.todoCountOne", {
        count: data.todo.length,
      });
    }
    if (data.simulations.total === 0 && Object.keys(data.offers.status_counts).length === 0) {
      return t("dashboard.subtitleStart");
    }
    return t("dashboard.subtitleUpToDate");
  }, [data, t]);

  const showOnboarding =
    data &&
    data.simulations.total === 0 &&
    Object.values(data.offers.status_counts).every((n) => !n);

  const offerActive = data
    ? (data.offers.status_counts.draft ?? 0) + (data.offers.status_counts.sent ?? 0)
    : 0;

  const kpiItems = data
    ? [
        {
          label: t("nav.catalog"),
          value: data.catalog.product_count.toLocaleString("fr-FR"),
          subValue: t("dashboard.kpiUnivers", { count: data.catalog.universe_count }),
          href: "/catalog",
          icon: SquaresFour,
          tone: "navy" as const,
        },
        {
          label: t("nav.simulations"),
          value: data.simulations.total,
          subValue: [
            t(data.simulations.draft !== 1 ? "dashboard.simDraftOther" : "dashboard.simDraftOne", {
              count: data.simulations.draft,
            }),
            t(
              data.simulations.finalized !== 1
                ? "dashboard.simFinalizedOther"
                : "dashboard.simFinalizedOne",
              { count: data.simulations.finalized },
            ),
            t("dashboard.simDirty", { count: data.simulations.dirty }),
          ].join(" · "),
          href: "/simulator",
          icon: ChartLineUp,
          tone: "primary" as const,
        },
        {
          label: t("nav.offers"),
          value: offerActive,
          subValue: [
            t(
              data.offers.tariff_active !== 1
                ? "dashboard.tariffActiveOther"
                : "dashboard.tariffActiveOne",
              { count: data.offers.tariff_active },
            ),
            data.offers.project_conversion_pct != null
              ? t("dashboard.projectConversion", {
                  pct: data.offers.project_conversion_pct.toFixed(0),
                })
              : null,
            data.offers.won_total
              ? t("dashboard.wonAmount", { amount: fmtEur(data.offers.won_total) })
              : null,
          ]
            .filter(Boolean)
            .join(" · "),
          href: "/offers",
          icon: FilePlus,
          tone: "warm" as const,
        },
        {
          label: t("nav.comparisons"),
          value: data.comparisons.total,
          subValue: t("dashboard.kpiAnalyses"),
          href: "/comparator",
          icon: GitDiff,
          tone: "blue" as const,
        },
        {
          label: t("nav.library"),
          value: data.library.document_count.toLocaleString("fr-FR"),
          subValue: t("dashboard.kpiDocuments"),
          href: "/library",
          icon: Books,
          tone: "navy" as const,
        },
      ]
    : [];

  const quickActions = [
    {
      label: t("nav.newSimulation"),
      description: t("dashboard.newSimulationDesc"),
      href: "/simulator/new",
      icon: Plus,
    },
    {
      label: t("nav.newComparison"),
      description: t("dashboard.newComparisonDesc"),
      href: "/comparator/new",
      icon: Columns,
    },
    {
      label: t("nav.newOffer"),
      description: t("dashboard.newOfferDesc"),
      href: "/offers",
      icon: FilePlus,
    },
    ...(userCanEdit
      ? [
          {
            label: t("nav.newProduct"),
            description: t("dashboard.newProductDesc"),
            href: "/catalog/new",
            icon: SquaresFour,
          },
        ]
      : []),
  ];

  return (
    <div className="p-6 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300">
      <PageHeader title={greeting} description={subtitle} />

      {showOnboarding && (
        <div className="mb-8">
          <DashboardOnboarding />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <DashboardTodoPanel items={data?.todo ?? []} loading={isLoading} />
          <DashboardResumeCard />
          <DashboardActivityTimeline items={data?.recent ?? []} loading={isLoading} />
        </div>

        <div className="space-y-6">
          {!showOnboarding && (
            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t("dashboard.businessBlocks")}
              </h2>
              <DashboardKpiGrid items={kpiItems} loading={isLoading} />
            </section>
          )}

          <DashboardMarketCard />

          <DashboardCompletenessCard />

          {userCanEdit && (
            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t("dashboard.shortcuts")}
              </h2>
              <DashboardQuickActions items={quickActions} loading={isLoading} />
            </section>
          )}

          {userIsAdmin && <DashboardAdminLinks />}
        </div>
      </div>
    </div>
  );
}
