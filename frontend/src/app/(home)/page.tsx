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

export default function HomePage() {
  const { user } = useAuth();
  const userCanEdit = canEdit(user?.role);
  const userIsAdmin = isAdmin(user?.role);

  const { data, isLoading } = useSWR("dashboard-summary", getDashboardSummary);

  const greeting = useMemo(() => {
    const name = user?.first_name?.trim();
    return name ? `Bonjour, ${name}` : "Bonjour";
  }, [user?.first_name]);

  const subtitle = useMemo(() => {
    if (!data) return "Vue d'ensemble de votre activité pricing.";
    if (data.todo.length > 0) {
      return `${data.todo.length} élément${data.todo.length > 1 ? "s" : ""} à traiter`;
    }
    if (data.simulations.total === 0 && Object.keys(data.offers.status_counts).length === 0) {
      return "Commencez par explorer le catalogue et créer votre première simulation.";
    }
    return "Tout est à jour.";
  }, [data]);

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
          label: "Catalogue",
          value: data.catalog.product_count.toLocaleString("fr-FR"),
          subValue: `${data.catalog.universe_count} univers`,
          href: "/catalog",
          icon: SquaresFour,
          tone: "navy" as const,
        },
        {
          label: "Simulations",
          value: data.simulations.total,
          subValue: `${data.simulations.draft} brouillon${data.simulations.draft !== 1 ? "s" : ""} · ${data.simulations.finalized} finalisée${data.simulations.finalized !== 1 ? "s" : ""} · ${data.simulations.dirty} à recalculer`,
          href: "/simulator",
          icon: ChartLineUp,
          tone: "primary" as const,
        },
        {
          label: "Offres",
          value: offerActive,
          subValue: [
            `${data.offers.tariff_active} tarif${data.offers.tariff_active !== 1 ? "s" : ""} actif${data.offers.tariff_active !== 1 ? "s" : ""}`,
            data.offers.project_conversion_pct != null
              ? `${data.offers.project_conversion_pct.toFixed(0)} % conversion projets`
              : null,
            data.offers.won_total ? fmtEur(data.offers.won_total) + " gagnés" : null,
          ]
            .filter(Boolean)
            .join(" · "),
          href: "/offers",
          icon: FilePlus,
          tone: "warm" as const,
        },
        {
          label: "Comparaisons",
          value: data.comparisons.total,
          subValue: "Analyses côte à côte",
          href: "/comparator",
          icon: GitDiff,
          tone: "blue" as const,
        },
        {
          label: "Bibliothèque",
          value: data.library.document_count.toLocaleString("fr-FR"),
          subValue: "Documents partagés",
          href: "/library",
          icon: Books,
          tone: "navy" as const,
        },
      ]
    : [];

  const quickActions = [
    {
      label: "Nouvelle simulation",
      description: "Lancer un calcul de pricing sur une sélection de SKU.",
      href: "/simulator/new",
      icon: Plus,
    },
    {
      label: "Nouvelle comparaison",
      description: "Comparer plusieurs simulations avec aperçu des SKU communs.",
      href: "/comparator/new",
      icon: Columns,
    },
    {
      label: "Nouvelle offre",
      description: "Générer une offre tarif ou projet.",
      href: "/offers",
      icon: FilePlus,
    },
    ...(userCanEdit
      ? [
          {
            label: "Nouveau produit",
            description: "Ajouter un produit au catalogue PIM.",
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
                Briques métier
              </h2>
              <DashboardKpiGrid items={kpiItems} loading={isLoading} />
            </section>
          )}

          <DashboardMarketCard />

          {userCanEdit && (
            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Raccourcis
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
