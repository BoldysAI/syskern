"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import useSWR, { mutate as globalMutate } from "swr";
import { AlertCircle, PanelLeftOpen } from "lucide-react";
import { exportSimulation, getSimulation, type SimulationDetail } from "@/lib/api";
import {
  useBreadcrumbOverride,
  type BreadcrumbCrumb,
} from "@/components/layout/BreadcrumbContext";
import { useResizableWidth } from "@/hooks/useResizableWidth";
import { cn } from "@/lib/utils";
import { SimulationSidebar } from "./_components/SimulationSidebar";
import { SimulationTable } from "./_components/SimulationTable";
import { RecalculateModal } from "./_components/RecalculateModal";
import { BulkEditModal } from "./_components/BulkEditModal";
import { RecalcHistoryDrawer } from "./_components/RecalcHistoryDrawer";

export default function SimulationDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";

  const {
    data: sim,
    isLoading,
    error,
    mutate: mutateSim,
  } = useSWR<SimulationDetail>(id ? ["simulation", id] : null, () => getSimulation(id));

  const [collapsed, setCollapsed] = useState(false);
  const { width: sidebarWidth, startResize, isResizing } = useResizableWidth(360, {
    min: 280,
    max: 640,
    storageKey: "syskern:simulation-sidebar-width",
  });
  const [recalcOpen, setRecalcOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pendingMarketParams, setPendingMarketParams] = useState<Record<string, string> | null>(
    null
  );

  const breadcrumbCrumbs = useMemo((): BreadcrumbCrumb[] | null => {
    if (!sim) return null;
    return [
      { href: "/catalog", label: "Accueil" },
      { href: "/simulator", label: "Simulations" },
      { label: sim.label },
    ];
  }, [sim]);

  useBreadcrumbOverride(breadcrumbCrumbs, Boolean(sim));

  const refreshLines = () =>
    globalMutate((key) => Array.isArray(key) && key[0] === "sim-lines");

  const refreshAll = () => {
    void mutateSim();
    void refreshLines();
  };

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-slate-500">
        <AlertCircle size={40} className="text-red-300" />
        <p className="font-medium">Simulation introuvable</p>
        <Link href="/simulator" className="mt-2 text-sm font-medium text-warm hover:text-accent-foreground">
          Retour aux simulations
        </Link>
      </div>
    );
  }

  if (isLoading || !sim) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
      </div>
    );
  }

  const readOnly = sim.status !== "draft";

  return (
    <div className="flex h-full min-h-0">
      {/* Left sidebar (collapsible) */}
      {collapsed ? (
        <div className="flex w-12 shrink-0 flex-col items-center border-r border-border bg-white py-3">
          <button
            onClick={() => setCollapsed(false)}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Afficher le panneau des paramètres"
          >
            <PanelLeftOpen size={18} />
          </button>
        </div>
      ) : (
        <aside
          className="relative shrink-0 border-r border-border bg-[#FAFBFC]"
          style={{ width: sidebarWidth }}
        >
          <SimulationSidebar
            key={sim.id}
            sim={sim}
            readOnly={readOnly}
            onChanged={() => void mutateSim()}
            onCollapse={() => setCollapsed(true)}
            onMarketParamsChange={setPendingMarketParams}
          />
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Redimensionner le panneau des paramètres"
            onMouseDown={startResize}
            className={cn(
              "absolute right-0 top-0 z-20 flex h-full w-1.5 cursor-col-resize touch-none items-center justify-center transition-colors",
              "hover:bg-primary/20",
              isResizing && "bg-primary/30"
            )}
          >
            <span className="h-10 w-0.5 rounded-full bg-slate-300" />
          </div>
        </aside>
      )}

      {/* Central results zone */}
      <main className="min-w-0 flex-1 bg-white">
        <SimulationTable
          sim={sim}
          readOnly={readOnly}
          onRecalc={() => setRecalcOpen(true)}
          onBulkEdit={() => setBulkOpen(true)}
          onExport={() => exportSimulation(sim.id)}
          onHistory={() => setHistoryOpen(true)}
          onChanged={() => void mutateSim()}
        />
      </main>

      <RecalculateModal
        simId={sim.id}
        lineCount={sim.line_count}
        marketParams={pendingMarketParams ?? undefined}
        open={recalcOpen}
        onClose={() => setRecalcOpen(false)}
        onDone={refreshAll}
      />
      <BulkEditModal
        simId={sim.id}
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        onApplied={refreshAll}
      />
      <RecalcHistoryDrawer simId={sim.id} open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </div>
  );
}
