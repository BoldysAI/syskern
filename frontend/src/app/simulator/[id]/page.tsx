"use client";

import { useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import useSWR, { mutate as globalMutate } from "swr";
import { SidebarSimple, WarningCircle } from "@phosphor-icons/react";
import { exportSimulation, getSimulation, type SimulationDetail } from "@/lib/api";
import {
  useBreadcrumbOverride,
  type BreadcrumbCrumb,
} from "@/components/layout/BreadcrumbContext";
import { useResizableWidth } from "@/hooks/useResizableWidth";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { SimulationSidebar } from "./_components/SimulationSidebar";
import { SimulationTable } from "./_components/SimulationTable";
import { RecalculateModal } from "./_components/RecalculateModal";
import { BulkEditModal } from "./_components/BulkEditModal";
import { AddProductsModal } from "./_components/AddProductsModal";
import { RecalcHistoryDrawer } from "./_components/RecalcHistoryDrawer";

export default function SimulationDetailPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
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
  const [bulkLineIds, setBulkLineIds] = useState<string[] | null>(null);
  const [addProductsOpen, setAddProductsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pendingMarketParams, setPendingMarketParams] = useState<Record<string, string> | null>(
    null
  );

  const breadcrumbCrumbs = useMemo((): BreadcrumbCrumb[] | null => {
    if (!sim) return null;

    const from = searchParams.get("from");
    const productSku = searchParams.get("product_sku");
    const productLabel = searchParams.get("product_label");
    const productTab = searchParams.get("product_tab");

    if (from === "catalog" && productSku) {
      const productQ = new URLSearchParams();
      if (productTab) productQ.set("tab", productTab);
      const productHref = `/catalog/${encodeURIComponent(productSku)}${
        productQ.size ? `?${productQ.toString()}` : ""
      }`;
      return [
        { href: "/", label: "Tableau de bord" },
        { href: "/catalog", label: "Catalogue" },
        { href: productHref, label: productLabel || productSku },
        { label: sim.label },
      ];
    }

    return [
      { href: "/", label: "Tableau de bord" },
      { href: "/simulator", label: "Simulations" },
      { label: sim.label },
    ];
  }, [sim, searchParams]);

  useBreadcrumbOverride(breadcrumbCrumbs, Boolean(sim));

  const refreshLines = () =>
    globalMutate((key) => Array.isArray(key) && key[0] === "sim-lines");

  const refreshAll = () => {
    void mutateSim();
    void refreshLines();
  };

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-muted-foreground">
        <WarningCircle size={40} weight="duotone" className="text-destructive/60" />
        <p className="font-medium text-foreground">Simulation introuvable</p>
        <Link href="/simulator" className="mt-2 text-sm font-medium text-warm hover:text-accent-foreground">
          Retour aux simulations
        </Link>
      </div>
    );
  }

  if (isLoading || !sim) {
    return (
      <div className="flex h-full gap-0 p-0">
        <div className="hidden w-[360px] shrink-0 border-r border-border bg-muted/30 p-4 md:block">
          <Skeleton className="mb-4 h-8 w-3/4" />
          <Skeleton className="mb-2 h-4 w-full" />
          <Skeleton className="mb-6 h-32 w-full rounded-xl" />
          <Skeleton className="mb-6 h-40 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
        <div className="min-w-0 flex-1 space-y-3 p-5">
          <Skeleton className="h-16 w-full rounded-lg" />
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    );
  }

  const readOnly = sim.status !== "draft";

  return (
    <div className="flex h-full min-h-0">
      {collapsed ? (
        <div className="flex w-12 shrink-0 flex-col items-center border-r border-border bg-card py-3">
          <button
            onClick={() => setCollapsed(false)}
            className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Afficher le panneau des paramètres"
          >
            <SidebarSimple size={18} />
          </button>
        </div>
      ) : (
        <aside
          className="relative shrink-0 border-r border-border bg-muted/30"
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
            <span className="h-10 w-0.5 rounded-full bg-border" />
          </div>
        </aside>
      )}

      <main className="min-w-0 flex-1 bg-background">
        <SimulationTable
          sim={sim}
          readOnly={readOnly}
          onRecalc={() => setRecalcOpen(true)}
          onAddProducts={() => setAddProductsOpen(true)}
          onBulkEdit={(lineIds) => {
            setBulkLineIds(lineIds?.length ? lineIds : null);
            setBulkOpen(true);
          }}
          onExport={() => exportSimulation(sim.id)}
          onHistory={() => setHistoryOpen(true)}
          onChanged={() => void mutateSim()}
        />
      </main>

      <RecalculateModal
        simId={sim.id}
        marketParams={pendingMarketParams ?? undefined}
        open={recalcOpen}
        onClose={() => setRecalcOpen(false)}
        onDone={refreshAll}
      />
      <AddProductsModal
        simId={sim.id}
        open={addProductsOpen}
        onClose={() => setAddProductsOpen(false)}
        onAdded={refreshAll}
      />
      <BulkEditModal
        simId={sim.id}
        open={bulkOpen}
        lineIds={bulkLineIds}
        onClose={() => {
          setBulkOpen(false);
          setBulkLineIds(null);
        }}
        onApplied={refreshAll}
      />
      <RecalcHistoryDrawer simId={sim.id} open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </div>
  );
}
