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
  settings: { label: "Paramètres", href: "/settings" },
  admin: { label: "Admin", href: "/admin" },
};

const SEGMENT_LABELS: Record<string, string> = {
  new: "Nouveau produit",
  users: "Utilisateurs",
};

/** Build default crumbs from the URL path — every intermediate segment is clickable. */
export function buildAutoBreadcrumbs(pathname: string): BreadcrumbCrumb[] {
  const segments = pathname.split("/").filter(Boolean);
  const crumbs: BreadcrumbCrumb[] = [{ label: "Accueil", href: "/catalog" }];

  if (segments.length === 0) {
    return [{ label: "Accueil" }];
  }

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const isLast = i === segments.length - 1;
    const pathSoFar = `/${segments.slice(0, i + 1).join("/")}`;

    if (i === 0 && SECTION_LABELS[seg]) {
      crumbs.push({
        label: SECTION_LABELS[seg].label,
        href: isLast ? undefined : SECTION_LABELS[seg].href,
      });
      continue;
    }

    const mapped = SEGMENT_LABELS[seg];
    if (mapped) {
      crumbs.push({
        label: mapped,
        href: isLast ? undefined : pathSoFar,
      });
      continue;
    }

    crumbs.push({
      label: seg,
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
    <nav aria-label="Fil d'Ariane" className="flex min-w-0 items-center gap-1.5 text-sm text-slate-500">
      {crumbs.map((crumb, index) => {
        const isLast = index === crumbs.length - 1;
        return (
          <span key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1.5">
            {index > 0 && <ChevronRight size={14} className="shrink-0 text-slate-400" />}
            {crumb.href && !isLast ? (
              <Link
                href={crumb.href}
                className="truncate transition-colors hover:text-slate-800"
                title={crumb.label}
              >
                {crumb.label}
              </Link>
            ) : (
              <span
                className={cn("truncate", isLast ? "font-medium text-slate-800" : "text-slate-500")}
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
