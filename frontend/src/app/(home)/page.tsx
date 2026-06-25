"use client";

import { useMemo } from "react";
import Link from "next/link";
import useSWR from "swr";
import {
  Books,
  ChartLineUp,
  Columns,
  FilePlus,
  Files,
  Plus,
  SquaresFour,
} from "@phosphor-icons/react";
import {
  getDocumentLibraryCount,
  getOffersDashboard,
  getProducts,
  getRecentOffers,
  getSimulations,
  getUniverses,
} from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { DashboardKpiGrid } from "@/app/_components/DashboardKpiGrid";
import { DashboardQuickActions } from "@/app/_components/DashboardQuickActions";
import { DashboardRecentActivity } from "@/app/_components/DashboardRecentActivity";

export default function HomePage() {
  const { user } = useAuth();

  const { data: products, isLoading: loadingProducts } = useSWR("dashboard-products", () =>
    getProducts({ limit: 1 }),
  );
  const { data: universes, isLoading: loadingUniverses } = useSWR("dashboard-universes", getUniverses);
  const { data: simulations, isLoading: loadingSims } = useSWR("dashboard-sims", () =>
    getSimulations({ includeArchived: false }),
  );
  const { data: offersDash, isLoading: loadingOffersDash } = useSWR(
    "offers-dashboard",
    getOffersDashboard,
  );
  const { data: docCount, isLoading: loadingDocs } = useSWR("dashboard-docs", getDocumentLibraryCount);
  const { data: recentOffers, isLoading: loadingRecentOffers } = useSWR("dashboard-recent-offers", () =>
    getRecentOffers(5),
  );

  const greeting = useMemo(() => {
    const name = user?.first_name?.trim();
    return name ? `Bonjour, ${name}` : "Bonjour";
  }, [user?.first_name]);

  const simStats = useMemo(() => {
    const list = simulations ?? [];
    const drafts = list.filter((s) => s.status === "draft").length;
    const finalized = list.filter((s) => s.status === "finalized").length;
    return { drafts, finalized };
  }, [simulations]);

  const offerActive = useMemo(() => {
    if (!offersDash) return 0;
    const c = offersDash.status_counts;
    return (c.draft ?? 0) + (c.sent ?? 0);
  }, [offersDash]);

  const recentSims = useMemo(
    () =>
      [...(simulations ?? [])]
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
        .slice(0, 5),
    [simulations],
  );

  const kpiLoading = loadingProducts || loadingUniverses || loadingSims || loadingOffersDash || loadingDocs;

  const kpiItems = [
    {
      label: "Catalogue",
      value: products?.count?.toLocaleString("fr-FR") ?? "—",
      subValue: universes ? `${universes.length} univers` : undefined,
      href: "/catalog",
      icon: SquaresFour,
      tone: "navy" as const,
    },
    {
      label: "Simulations",
      value: simStats.drafts,
      subValue: `${simStats.finalized} finalisée${simStats.finalized > 1 ? "s" : ""}`,
      href: "/simulator",
      icon: ChartLineUp,
      tone: "primary" as const,
    },
    {
      label: "Offres",
      value: offerActive,
      subValue: offersDash ? `${offersDash.tariff_active} tarif${offersDash.tariff_active > 1 ? "s" : ""} actif${offersDash.tariff_active > 1 ? "s" : ""}` : undefined,
      href: "/offers",
      icon: Files,
      tone: "warm" as const,
    },
    {
      label: "Bibliothèque",
      value: docCount?.toLocaleString("fr-FR") ?? "—",
      subValue: "Documents partagés",
      href: "/library",
      icon: Books,
      tone: "blue" as const,
    },
  ];

  const quickActions = [
    {
      label: "Nouvelle simulation",
      description: "Lancer un calcul de pricing sur une sélection de SKU.",
      href: "/simulator/new",
      icon: Plus,
    },
    {
      label: "Parcourir le catalogue",
      description: "Consulter et filtrer les produits du PIM.",
      href: "/catalog",
      icon: SquaresFour,
    },
    {
      label: "Nouvelle offre",
      description: "Générer une offre tarif ou projet.",
      href: "/offers",
      icon: FilePlus,
    },
    {
      label: "Comparer",
      description: "Analyser plusieurs simulations côte à côte.",
      href: "/simulator/compare",
      icon: Columns,
    },
  ];

  return (
    <div className="p-6 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300">
      <PageHeader
        title={greeting}
        description="Vue d'ensemble de votre activité pricing."
        actions={
          <Button nativeButton={false} render={<Link href="/simulator/new" />}>
            <Plus size={16} weight="bold" />
            Nouvelle simulation
          </Button>
        }
      />

      <section className="mb-8">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Briques métier
        </h2>
        <DashboardKpiGrid items={kpiItems} loading={kpiLoading} />
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Raccourcis
        </h2>
        <DashboardQuickActions items={quickActions} loading={kpiLoading} />
      </section>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Activité récente
        </h2>
        <DashboardRecentActivity
          simulations={recentSims}
          offers={recentOffers ?? []}
          loadingSims={loadingSims}
          loadingOffers={loadingRecentOffers}
        />
      </section>
    </div>
  );
}
