"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { AppIcon } from "@/components/AppIcon";
import { Clock, FileText } from "@phosphor-icons/react";

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

const OFFER_STATUS: Record<string, { label: string; variant: "default" | "info" | "success" | "warning" | "failed" | "draft" }> = {
  draft: { label: "Brouillon", variant: "draft" },
  sent: { label: "Envoyée", variant: "info" },
  won: { label: "Gagnée", variant: "success" },
  lost: { label: "Perdue", variant: "failed" },
  expired: { label: "Expirée", variant: "warning" },
};

const SIM_STATUS: Record<string, { label: string; variant: "default" | "info" | "success" | "warning" | "failed" | "draft" }> = {
  draft: { label: "Brouillon", variant: "warning" },
  finalized: { label: "Finalisé", variant: "success" },
  archived: { label: "Archivé", variant: "draft" },
};

function formatRelative(dateStr: string): string {
  const date = new Date(dateStr);
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "à l'instant";
  if (diffMin < 60) return `il y a ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `il y a ${diffH} h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `il y a ${diffD} j`;
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

function ActivityListSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-14 rounded-lg" />
      ))}
    </div>
  );
}

interface ActivityPanelProps {
  title: string;
  href: string;
  loading?: boolean;
  emptyTitle: string;
  emptyDescription: string;
  emptyIcon: React.ReactNode;
  children: React.ReactNode;
}

function ActivityPanel({
  title,
  href,
  loading,
  emptyTitle,
  emptyDescription,
  emptyIcon,
  children,
}: ActivityPanelProps) {
  return (
    <section className="rounded-xl border bg-card p-4 shadow-[var(--shadow-soft)]">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <Link href={href} className="text-xs font-medium text-primary hover:underline">
          Voir tout
        </Link>
      </div>
      {loading ? <ActivityListSkeleton /> : children}
    </section>
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
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ActivityPanel
        title="Dernières simulations"
        href="/simulator"
        loading={loadingSims}
        emptyTitle="Aucune simulation"
        emptyDescription="Créez votre première simulation pour commencer."
        emptyIcon={<Clock size={24} weight="duotone" />}
      >
        {simulations.length === 0 ? (
          <EmptyState
            icon={<AppIcon icon={Clock} weight="duotone" size="lg" />}
            title="Aucune simulation"
            description="Créez votre première simulation pour commencer."
            className="py-8"
          />
        ) : (
          <ul className="space-y-2">
            {simulations.map((sim) => {
              const st = SIM_STATUS[sim.status] ?? SIM_STATUS.draft;
              return (
                <li key={sim.id}>
                  <Link
                    href={`/simulator/${sim.id}`}
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-lg border border-transparent px-3 py-2.5 transition-colors",
                      "hover:border-border hover:bg-muted/40",
                    )}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{sim.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {sim.simulation_type === "project" ? "Projet" : "Tarif"} · {formatRelative(sim.updated_at)}
                      </p>
                    </div>
                    <StatusBadge variant={st.variant}>{st.label}</StatusBadge>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </ActivityPanel>

      <ActivityPanel
        title="Dernières offres"
        href="/offers"
        loading={loadingOffers}
        emptyTitle="Aucune offre"
        emptyDescription="Générez une offre à partir d'une simulation finalisée."
        emptyIcon={<FileText size={24} weight="duotone" />}
      >
        {offers.length === 0 ? (
          <EmptyState
            icon={<AppIcon icon={FileText} weight="duotone" size="lg" />}
            title="Aucune offre"
            description="Générez une offre à partir d'une simulation finalisée."
            className="py-8"
          />
        ) : (
          <ul className="space-y-2">
            {offers.map((offer) => {
              const st = OFFER_STATUS[offer.status] ?? { label: offer.status, variant: "default" as const };
              return (
                <li key={offer.id}>
                  <Link
                    href={`/offers/${offer.id}`}
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-lg border border-transparent px-3 py-2.5 transition-colors",
                      "hover:border-border hover:bg-muted/40",
                    )}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{offer.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {offer.offer_type === "project" ? "Projet" : "Tarif"} · {formatRelative(offer.created_at)}
                      </p>
                    </div>
                    <StatusBadge variant={st.variant}>{st.label}</StatusBadge>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </ActivityPanel>
    </div>
  );
}
