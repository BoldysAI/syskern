"use client";

import useSWR from "swr";
import { CircleNotch, Intersect, Stack } from "@phosphor-icons/react";
import type { Simulation } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  computeSkuOverlap,
  fetchSimulationSkus,
} from "@/app/comparator/_components/simulation-skus";

interface Props {
  simulationIds: string[];
  simulations: Simulation[];
  className?: string;
}

async function loadOverlapStats(
  simulationIds: string[],
  simulations: Simulation[],
) {
  const simMap = new Map(simulations.map((s) => [s.id, s]));
  const data = await Promise.all(
    simulationIds.map(async (id) => {
      const lines = await fetchSimulationSkus(id);
      return {
        id,
        label: simMap.get(id)?.label ?? id.slice(0, 8),
        lines,
      };
    }),
  );
  return computeSkuOverlap(data);
}

export function SkuOverlapPreview({ simulationIds, simulations, className }: Props) {
  const swrKey =
    simulationIds.length > 0
      ? ["sku-overlap", simulationIds.join(","), simulations.length]
      : null;

  const { data: stats, isLoading, error } = useSWR(
    swrKey,
    () => loadOverlapStats(simulationIds, simulations),
  );

  if (simulationIds.length === 0) {
    return (
      <div
        className={cn(
          "rounded-xl border border-dashed border-border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground",
          className,
        )}
      >
        Sélectionnez au moins une simulation pour voir l&apos;aperçu des SKU.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div
        className={cn(
          "flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-10 text-sm text-muted-foreground",
          className,
        )}
      >
        <CircleNotch size={18} className="animate-spin" />
        Analyse des SKU en commun…
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={cn(
          "rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-6 text-sm text-destructive",
          className,
        )}
      >
        {error instanceof Error ? error.message : "Impossible de charger les SKU."}
      </div>
    );
  }

  if (!stats) return null;

  const overlapPct =
    stats.unionCount > 0 ? Math.round((stats.commonCount / stats.unionCount) * 100) : 0;

  return (
    <div className={cn("space-y-4", className)}>
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          icon={<Stack size={18} className="text-primary" />}
          label="SKU par simulation"
          value={stats.perSimulation.map((s) => `${s.label}: ${s.skuCount}`).join(" · ")}
        />
        <StatCard
          icon={<Intersect size={18} className="text-warm" />}
          label="SKU en commun"
          value={`${stats.commonCount} SKU`}
          highlight={simulationIds.length >= 2}
        />
        <StatCard
          label="Couverture"
          value={
            simulationIds.length >= 2
              ? `${overlapPct} % de recouvrement`
              : "Sélectionnez 2 simulations minimum"
          }
        />
      </div>

      {simulationIds.length >= 2 && stats.commonCount === 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Aucun SKU en commun entre ces simulations — la comparaison produit sera vide ou limitée.
        </div>
      )}

      {stats.commonSkus.length > 0 && (
        <div className="rounded-xl border border-border bg-card">
          <div className="border-b border-border px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            SKU communs ({stats.commonSkus.length})
          </div>
          <ul className="max-h-48 divide-y divide-border overflow-y-auto">
            {stats.commonSkus.slice(0, 20).map((sku) => (
              <li key={sku.productId} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                <span className="font-data font-medium text-foreground">{sku.sku}</span>
                <span className="min-w-0 truncate text-muted-foreground">{sku.name}</span>
              </li>
            ))}
            {stats.commonSkus.length > 20 && (
              <li className="px-4 py-2 text-xs text-muted-foreground">
                + {stats.commonSkus.length - 20} autres SKU communs
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  highlight,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card px-4 py-3",
        highlight && "ring-1 ring-warm/30",
      )}
    >
      <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}
