/**
 * Simulation deep-links and breadcrumb context.
 *
 * Rule: navigation from a comparison view to `/simulator/[id]` must carry
 * `?from=…` query params so breadcrumbs reflect the user's path back.
 */

import type { BreadcrumbCrumb } from "@/components/layout/BreadcrumbContext";

export type SimulationNavigationContext =
  | { kind: "default" }
  | {
      kind: "compare";
      returnHref: string;
      returnLabel: string;
    };

type SearchParamsLike = { get(name: string): string | null };

export function parseSimulationNavigationContext(
  params: SearchParamsLike,
): SimulationNavigationContext {
  const from = params.get("from");
  if (from === "compare" || from === "comparator") {
    const returnHref = params.get("return_href");
    if (returnHref) {
      return {
        kind: "compare",
        returnHref,
        returnLabel: params.get("return_label") || "Comparaison",
      };
    }
  }
  return { kind: "default" };
}

function navigationToSearchParams(ctx: SimulationNavigationContext): URLSearchParams {
  const q = new URLSearchParams();
  if (ctx.kind === "compare") {
    q.set("from", "compare");
    q.set("return_href", ctx.returnHref);
    q.set("return_label", ctx.returnLabel);
  }
  return q;
}

/** Build `/simulator/[id]` preserving navigation context for breadcrumbs. */
export function buildSimulationHref(
  simulationId: string,
  ctx: SimulationNavigationContext = { kind: "default" },
): string {
  const q = navigationToSearchParams(ctx);
  const qs = q.toString();
  return `/simulator/${encodeURIComponent(simulationId)}${qs ? `?${qs}` : ""}`;
}

/** Breadcrumb trail for simulation detail — must mirror `parseSimulationNavigationContext`. */
export function buildSimulationBreadcrumbs(
  ctx: SimulationNavigationContext,
  simulationLabel: string,
): BreadcrumbCrumb[] {
  const dashboard: BreadcrumbCrumb = { href: "/", label: "Tableau de bord" };

  if (ctx.kind === "compare") {
    return [
      dashboard,
      { href: "/comparator", label: "Comparaisons" },
      { href: ctx.returnHref, label: ctx.returnLabel },
      { label: simulationLabel },
    ];
  }

  return [
    dashboard,
    { href: "/simulator", label: "Simulations" },
    { label: simulationLabel },
  ];
}

/** Context for links opened from a live comparison workspace. */
export function compareSimulationNavContext(
  returnHref: string,
  returnLabel: string,
): SimulationNavigationContext {
  return { kind: "compare", returnHref, returnLabel };
}
