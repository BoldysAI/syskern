"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Bell, BookmarkSimple, Coins, Database, Tag, Truck } from "@phosphor-icons/react";
import type { IconProps } from "@phosphor-icons/react";
import { AppIcon } from "@/components/AppIcon";
import { useUiTranslate } from "@/lib/use-ui-translate";
import { cn } from "@/lib/utils";

/**
 * Shared top-level navigation for the settings area (CDC §4.1.4 / §4.3).
 * The "Référentiels" sections (market / transport / odoo) live as query-param
 * tabs on `/settings`; "Attributs dynamiques" is its own route
 * `/settings/attributes`.
 */
export const SETTINGS_NAV_ITEMS = [
  { id: "marche", labelKey: "settings.nav.market", href: "/settings?tab=marche", icon: Coins },
  { id: "transport", labelKey: "settings.nav.transport", href: "/settings?tab=transport", icon: Truck },
  {
    id: "transport-presets",
    labelKey: "settings.nav.presets",
    href: "/settings?tab=transport-presets",
    icon: BookmarkSimple,
  },
  { id: "odoo", labelKey: "settings.nav.odoo", href: "/settings?tab=odoo", icon: Database },
  { id: "alerts", labelKey: "settings.nav.alerts", href: "/settings?tab=alerts", icon: Bell },
  { id: "attributes", labelKey: "settings.nav.attributes", href: "/settings/attributes", icon: Tag },
] as const satisfies ReadonlyArray<{
  id: string;
  labelKey: string;
  href: string;
  icon: React.ComponentType<IconProps>;
}>;

export function SettingsNavShell({ activeId }: { activeId?: string | null }) {
  const t = useUiTranslate();
  return (
    <div className="mb-6 flex gap-0.5 overflow-x-auto rounded-xl border border-border bg-card p-1 shadow-sm">
      {SETTINGS_NAV_ITEMS.map(({ id, labelKey, href, icon }) => {
        const active = activeId === id;
        return (
          <Link
            key={id}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex flex-shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <AppIcon icon={icon} size="sm" />
            {t(labelKey)}
          </Link>
        );
      })}
    </div>
  );
}

/** Static nav for Suspense fallbacks — links stay usable while the tab panel hydrates. */
export function SettingsNavFallback() {
  return <SettingsNavShell />;
}

export default function SettingsNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const onAttributes = pathname.startsWith("/settings/attributes");
  const activeTab = searchParams.get("tab") ?? "marche";
  const activeId = onAttributes ? "attributes" : activeTab;

  return <SettingsNavShell activeId={activeId} />;
}
