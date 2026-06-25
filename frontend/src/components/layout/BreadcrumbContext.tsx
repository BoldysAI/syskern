"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type BreadcrumbCrumb = {
  label: string;
  href?: string;
};

const BreadcrumbContext = createContext<{
  crumbs: BreadcrumbCrumb[] | null;
  setCrumbs: (crumbs: BreadcrumbCrumb[] | null) => void;
} | null>(null);

const SECTION_LABELS: Record<string, { label: string; href: string }> = {
  catalog: { label: "Catalogue", href: "/catalog" },
  simulator: { label: "Simulations", href: "/simulator" },
  offers: { label: "Offres", href: "/offers" },
  library: { label: "Bibliothèque", href: "/library" },
  settings: { label: "Paramètres", href: "/settings" },
  admin: { label: "Administration", href: "/admin/users" },
};

const SEGMENT_LABELS: Record<string, string> = {
  users: "Utilisateurs",
  compare: "Comparaison",
  attributes: "Registre des attributs",
  "migration-quarantine": "Quarantaine migration",
  "new-tariff": "Nouvelle offre tarif",
  "new-project": "Nouvelle offre projet",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(seg: string): boolean {
  return UUID_RE.test(seg);
}

/** Human-readable fallback — never expose raw ids or internal keys in the UI. */
function segmentLabel(seg: string, parentSeg?: string): string {
  if (SEGMENT_LABELS[seg]) return SEGMENT_LABELS[seg];

  if (seg === "new") {
    if (parentSeg === "catalog") return "Nouveau produit";
    if (parentSeg === "simulator") return "Nouvelle simulation";
    if (parentSeg === "offers") return "Nouvelle offre";
    return "Nouveau";
  }

  if (isUuid(seg)) {
    if (parentSeg === "simulator") return "Simulation";
    if (parentSeg === "offers") return "Offre";
    return "Détail";
  }

  if (parentSeg === "catalog") return "Fiche produit";
  if (parentSeg === "simulator") return "Simulation";
  if (parentSeg === "offers") return "Offre";

  return "Détail";
}

/** Build default crumbs from the URL path — every intermediate segment is clickable. */
export function buildAutoBreadcrumbs(pathname: string): BreadcrumbCrumb[] {
  if (pathname === "/") {
    return [{ label: "Tableau de bord" }];
  }

  const segments = pathname.split("/").filter(Boolean);
  const crumbs: BreadcrumbCrumb[] = [{ label: "Tableau de bord", href: "/" }];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const parentSeg = i > 0 ? segments[i - 1] : undefined;
    const isLast = i === segments.length - 1;
    const pathSoFar = `/${segments.slice(0, i + 1).join("/")}`;

    if (i === 0 && SECTION_LABELS[seg]) {
      crumbs.push({
        label: SECTION_LABELS[seg].label,
        href: isLast ? undefined : SECTION_LABELS[seg].href,
      });
      continue;
    }

    crumbs.push({
      label: segmentLabel(seg, parentSeg),
      href: isLast ? undefined : pathSoFar,
    });
  }

  return crumbs;
}

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [crumbs, setCrumbsState] = useState<BreadcrumbCrumb[] | null>(null);
  const setCrumbs = useCallback((next: BreadcrumbCrumb[] | null) => {
    setCrumbsState(next);
  }, []);

  const value = useMemo(() => ({ crumbs, setCrumbs }), [crumbs, setCrumbs]);

  return <BreadcrumbContext.Provider value={value}>{children}</BreadcrumbContext.Provider>;
}

export function useBreadcrumbOverride(crumbs: BreadcrumbCrumb[] | null, enabled = true) {
  const ctx = useContext(BreadcrumbContext);
  if (!ctx) {
    throw new Error("useBreadcrumbOverride must be used within BreadcrumbProvider");
  }

  useEffect(() => {
    if (!enabled) {
      ctx.setCrumbs(null);
      return;
    }
    ctx.setCrumbs(crumbs);
    return () => ctx.setCrumbs(null);
  }, [ctx, crumbs, enabled]);
}

export function BreadcrumbNav({ crumbs }: { crumbs: BreadcrumbCrumb[] }) {
  if (crumbs.length === 0) return null;

  return (
    <nav aria-label="Fil d'Ariane" className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
      {crumbs.map((crumb, index) => {
        const isLast = index === crumbs.length - 1;
        return (
          <span key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1.5">
            {index > 0 && <ChevronRight size={14} className="shrink-0 text-muted-foreground" />}
            {crumb.href && !isLast ? (
              <Link
                href={crumb.href}
                className="truncate transition-colors hover:text-foreground"
                title={crumb.label}
              >
                {crumb.label}
              </Link>
            ) : (
              <span
                className={cn("truncate", isLast ? "font-medium text-foreground" : "text-muted-foreground")}
                title={crumb.label}
              >
                {crumb.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}

export function AppBreadcrumb() {
  const pathname = usePathname();
  const ctx = useContext(BreadcrumbContext);
  const auto = useMemo(() => buildAutoBreadcrumbs(pathname), [pathname]);
  const crumbs = ctx?.crumbs ?? auto;
  return <BreadcrumbNav crumbs={crumbs} />;
}
