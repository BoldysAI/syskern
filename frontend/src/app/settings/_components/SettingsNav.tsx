"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Bell, Coins, Database, Tag, Truck } from "@phosphor-icons/react";
import { AppIcon } from "@/components/AppIcon";
import { cn } from "@/lib/utils";

/**
 * Shared top-level navigation for the settings area (CDC §4.1.4 / §4.3).
 * The "Référentiels" sections (market / transport / odoo) live as query-param
 * tabs on `/settings`; "Attributs dynamiques" is its own route
 * `/settings/attributes`.
 */
const ITEMS = [
  { id: "marche", label: "Paramètres marché", href: "/settings?tab=marche", icon: Coins },
  { id: "transport", label: "Modes de transport", href: "/settings?tab=transport", icon: Truck },
  { id: "odoo", label: "Synchronisation Odoo", href: "/settings?tab=odoo", icon: Database },
  { id: "alerts", label: "Alertes offres", href: "/settings?tab=alerts", icon: Bell },
  { id: "attributes", label: "Attributs dynamiques", href: "/settings/attributes", icon: Tag },
] as const;

export default function SettingsNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const onAttributes = pathname.startsWith("/settings/attributes");
  const activeTab = searchParams.get("tab") ?? "marche";

  return (
    <div className="mb-6 flex gap-0.5 overflow-x-auto rounded-xl border border-border bg-card p-1 shadow-sm">
      {ITEMS.map(({ id, label, href, icon }) => {
        const active = id === "attributes" ? onAttributes : !onAttributes && activeTab === id;
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
            {label}
          </Link>
        );
      })}
    </div>
  );
}
