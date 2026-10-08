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
import { translate, type MessageKey } from "@/lib/i18n";
import { useUiTranslate } from "@/lib/use-ui-translate";
import { cn } from "@/lib/utils";

export type BreadcrumbCrumb = {
  label: string;
  href?: string;
};

const BreadcrumbContext = createContext<{
  crumbs: BreadcrumbCrumb[] | null;
  setCrumbs: (crumbs: BreadcrumbCrumb[] | null) => void;
} | null>(null);

const SECTION_LABELS: Record<string, { labelKey: MessageKey; href: string }> = {
  catalog: { labelKey: "nav.catalog", href: "/catalog" },
  suppliers: { labelKey: "nav.suppliers", href: "/suppliers" },
  simulator: { labelKey: "nav.simulations", href: "/simulator" },
  comparator: { labelKey: "nav.comparisons", href: "/comparator" },
  offers: { labelKey: "nav.offers", href: "/offers" },
  library: { labelKey: "nav.library", href: "/library" },
  help: { labelKey: "nav.help", href: "/help" },
  settings: { labelKey: "nav.settings", href: "/settings" },
  admin: { labelKey: "nav.admin", href: "/admin/users" },
};

const SEGMENT_LABELS: Record<string, MessageKey> = {
  users: "nav.users",
  compare: "nav.comparison",
  attributes: "nav.attributes",
  "migration-quarantine": "nav.quarantine",
  "new-tariff": "nav.newTariffOffer",
  "new-project": "nav.newProjectOffer",
};

type TranslateFn = (key: MessageKey, vars?: Record<string, string | number>) => string;

function translateFr(key: MessageKey, vars?: Record<string, string | number>) {
  return translate(key, "fr", vars);
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(seg: string): boolean {
  return UUID_RE.test(seg);
}

/** Human-readable fallback — never expose raw ids or internal keys in the UI. */
function segmentLabel(seg: string, t: TranslateFn, parentSeg?: string): string {
  const staticKey = SEGMENT_LABELS[seg];
  if (staticKey) return t(staticKey);

  if (seg === "new") {
    if (parentSeg === "catalog") return t("nav.newProduct");
    if (parentSeg === "simulator") return t("nav.newSimulation");
    if (parentSeg === "comparator") return t("nav.newComparison");
    if (parentSeg === "offers") return t("nav.newOffer");
    return t("nav.new");
  }

  if (isUuid(seg)) {
    if (parentSeg === "simulator") return t("nav.simulation");
    if (parentSeg === "offers") return t("nav.offer");
    if (parentSeg === "comparator") return t("nav.comparison");
    return t("nav.detail");
  }

  if (parentSeg === "catalog") return t("nav.productSheet");
  if (parentSeg === "simulator") return t("nav.simulation");
  if (parentSeg === "comparator") return t("nav.comparison");
  if (parentSeg === "offers") return t("nav.offer");

  return t("nav.detail");
}

/** Build default crumbs from the URL path — every intermediate segment is clickable. */
export function buildAutoBreadcrumbs(pathname: string, t: TranslateFn = translateFr): BreadcrumbCrumb[] {
  if (pathname === "/") {
    return [{ label: t("nav.dashboard") }];
  }

  const segments = pathname.split("/").filter(Boolean);
  const crumbs: BreadcrumbCrumb[] = [{ label: t("nav.dashboard"), href: "/" }];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const parentSeg = i > 0 ? segments[i - 1] : undefined;
    const isLast = i === segments.length - 1;
    const pathSoFar = `/${segments.slice(0, i + 1).join("/")}`;

    if (i === 0 && SECTION_LABELS[seg]) {
      crumbs.push({
        label: t(SECTION_LABELS[seg].labelKey),
        href: isLast ? undefined : SECTION_LABELS[seg].href,
      });
      continue;
    }

    crumbs.push({
      label: segmentLabel(seg, t, parentSeg),
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
  const t = useUiTranslate();
  if (crumbs.length === 0) return null;

  return (
    <nav aria-label={t("nav.breadcrumb")} className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
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
  const t = useUiTranslate();
  const ctx = useContext(BreadcrumbContext);
  const auto = useMemo(() => buildAutoBreadcrumbs(pathname, t), [pathname, t]);
  const crumbs = ctx?.crumbs ?? auto;
  return <BreadcrumbNav crumbs={crumbs} />;
}
