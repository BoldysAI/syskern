/**
 * Product fiche deep-links and breadcrumb context.
 *
 * Rule: any navigation to `/catalog/[sku]` must carry `?from=…` query params so the
 * product page can render a breadcrumb that matches where the user came from.
 */

import type { BreadcrumbCrumb } from "@/components/layout/BreadcrumbContext";

export type ProductNavigationContext =
  | { kind: "catalog" }
  | { kind: "simulation"; simulationId: string; simulationLabel: string }
  | { kind: "supplier"; supplierId: string; supplierName: string };

type SearchParamsLike = { get(name: string): string | null };

export function parseProductNavigationContext(
  params: SearchParamsLike,
): ProductNavigationContext {
  const from = params.get("from");
  if (from === "simulation") {
    const simulationId = params.get("simulation_id");
    if (simulationId) {
      return {
        kind: "simulation",
        simulationId,
        simulationLabel: params.get("simulation_label") || "Simulation",
      };
    }
  }
  if (from === "supplier") {
    const supplierId = params.get("supplier_id");
    if (supplierId) {
      return {
        kind: "supplier",
        supplierId,
        supplierName: params.get("supplier_name") || "Fournisseur",
      };
    }
  }
  return { kind: "catalog" };
}

function navigationToSearchParams(ctx: ProductNavigationContext): URLSearchParams {
  const q = new URLSearchParams();
  if (ctx.kind === "simulation") {
    q.set("from", "simulation");
    q.set("simulation_id", ctx.simulationId);
    q.set("simulation_label", ctx.simulationLabel);
  } else if (ctx.kind === "supplier") {
    q.set("from", "supplier");
    q.set("supplier_id", ctx.supplierId);
    q.set("supplier_name", ctx.supplierName);
  }
  return q;
}

/** Build `/catalog/[sku]` preserving navigation context for breadcrumbs. */
export function buildProductHref(
  sku: string,
  ctx: ProductNavigationContext = { kind: "catalog" },
  options?: { edit?: boolean; tab?: string },
): string {
  const q = navigationToSearchParams(ctx);
  if (options?.edit) q.set("edit", "1");
  if (options?.tab) q.set("tab", options.tab);
  const qs = q.toString();
  return `/catalog/${encodeURIComponent(sku)}${qs ? `?${qs}` : ""}`;
}

/** Breadcrumb trail for the product fiche — must mirror `parseProductNavigationContext`. */
export function buildProductBreadcrumbs(
  ctx: ProductNavigationContext,
  opts: { productLabel: string; universe?: string | null },
): BreadcrumbCrumb[] {
  const dashboard: BreadcrumbCrumb = { href: "/", label: "Tableau de bord" };

  if (ctx.kind === "simulation") {
    return [
      dashboard,
      { href: "/simulator", label: "Simulations" },
      { href: `/simulator/${ctx.simulationId}`, label: ctx.simulationLabel },
      { label: opts.productLabel },
    ];
  }

  if (ctx.kind === "supplier") {
    return [
      dashboard,
      { href: "/suppliers", label: "Fournisseurs" },
      { href: `/suppliers/${ctx.supplierId}`, label: ctx.supplierName },
      { label: opts.productLabel },
    ];
  }

  const crumbs: BreadcrumbCrumb[] = [
    dashboard,
    { href: "/catalog", label: "Catalogue" },
  ];
  if (opts.universe) {
    crumbs.push({ label: opts.universe });
  }
  crumbs.push({ label: opts.productLabel });
  return crumbs;
}
