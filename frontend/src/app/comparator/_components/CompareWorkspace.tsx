"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { ChartBar, Gear, Stack } from "@phosphor-icons/react";
import {
  compareSimulations,
  getSimulations,
  type CompareResponse,
  type Simulation,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { CompareContextDiff } from "@/app/simulator/compare/_components/CompareContextDiff";
import { CompareOverview } from "@/app/simulator/compare/_components/CompareOverview";
import { CompareSkuTable } from "@/app/simulator/compare/_components/CompareSkuTable";

type TabId = "overview" | "context" | "products";

interface Props {
  simulationIds: string[];
  recalculationIds: string[];
}

export function CompareWorkspace({ simulationIds, recalculationIds }: Props) {
  const [tab, setTab] = useState<TabId>("overview");
  const [sortByDelta, setSortByDelta] = useState(true);
  const [commonOnly, setCommonOnly] = useState(true);

  const columnCount = simulationIds.length + recalculationIds.length;
  const compareKey =
    columnCount >= 2 ? ["compare", simulationIds.join(","), recalculationIds.join(",")] : null;

  const { data, isLoading, error } = useSWR<CompareResponse>(compareKey, () =>
    compareSimulations({
      simulation_ids: simulationIds,
      recalculation_ids: recalculationIds,
    }),
  );

  const { data: simulations } = useSWR<Simulation[]>("simulations", () => getSimulations());

  const selectedLabels = useMemo(() => {
    const map = new Map((simulations ?? []).map((s) => [s.id, s.label]));
    return simulationIds.map((id) => map.get(id) ?? id.slice(0, 8));
  }, [simulationIds, simulations]);

  if (!compareKey) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center text-muted-foreground">
        <p className="text-sm">Sélectionnez au moins 2 colonnes pour lancer la comparaison.</p>
      </div>
    );
  }

  if (isLoading) {
    return <div className="py-10 text-center text-sm text-muted-foreground">Comparaison…</div>;
  }

  if (error) {
    return (
      <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-red-700">
        {error instanceof Error ? error.message : "Comparaison échouée."}
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-5">
      {recalculationIds.length > 0 && (
        <div className="rounded-lg bg-accent px-4 py-2.5 text-sm text-accent-foreground">
          Comparaison incluant un ou plusieurs snapshots de recalcul historique.
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {selectedLabels.map((label, i) => (
          <span
            key={`${simulationIds[i]}-${i}`}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium",
              i === 0 ? "bg-brand-green/10 text-brand-green" : "bg-muted text-muted-foreground",
            )}
          >
            {i === 0 ? "Réf. · " : ""}
            {label}
          </span>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3">
        <TabButton
          active={tab === "overview"}
          onClick={() => setTab("overview")}
          icon={<ChartBar size={15} />}
          label="Synthèse"
        />
        <TabButton
          active={tab === "context"}
          onClick={() => setTab("context")}
          icon={<Gear size={15} />}
          label="Paramètres"
        />
        <TabButton
          active={tab === "products"}
          onClick={() => setTab("products")}
          icon={<Stack size={15} />}
          label="Lignes SKU"
          badge={data.products.length}
        />
      </div>

      {tab === "overview" && <CompareOverview columns={data.columns} products={data.products} />}
      {tab === "context" && <CompareContextDiff columns={data.columns} />}
      {tab === "products" && (
        <CompareSkuTable
          columns={data.columns}
          products={data.products}
          sortByDelta={sortByDelta}
          onToggleSort={() => setSortByDelta((v) => !v)}
          commonOnly={commonOnly}
          onToggleCommon={() => setCommonOnly((v) => !v)}
        />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-accent text-accent-foreground ring-1 ring-brand-green/30"
          : "text-muted-foreground hover:bg-muted",
      )}
    >
      {icon}
      {label}
      {badge != null && badge > 0 && (
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-bold",
            active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
          )}
        >
          {badge}
        </span>
      )}
    </button>
  );
}
