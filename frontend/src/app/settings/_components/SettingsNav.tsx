"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Coins, Truck, Database, Tags, Bell } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shared top-level navigation for the settings area (CDC §4.1.4 / §4.3).
 * The "Référentiels" sections (market / transport / odoo) live as query-param
 * tabs on `/settings`; "Attributs dynamiques" is its own route
 * `/settings/attributes`.
 */
const ITEMS = [
  { id: "marche", label: "Paramètres marché", href: "/settings?tab=marche", Icon: Coins },
  { id: "transport", label: "Modes de transport", href: "/settings?tab=transport", Icon: Truck },
  { id: "odoo", label: "Synchronisation Odoo", href: "/settings?tab=odoo", Icon: Database },
  { id: "alerts", label: "Alertes offres", href: "/settings?tab=alerts", Icon: Bell },
  { id: "attributes", label: "Attributs dynamiques", href: "/settings/attributes", Icon: Tags },
] as const;

export default function SettingsNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const onAttributes = pathname.startsWith("/settings/attributes");
  const activeTab = searchParams.get("tab") ?? "marche";

  return (
    <div className="flex gap-0.5 bg-white border border-[#E2E8F0] rounded-xl p-1 shadow-sm mb-6 overflow-x-auto">
      {ITEMS.map(({ id, label, href, Icon }) => {
        const active = id === "attributes" ? onAttributes : !onAttributes && activeTab === id;
        return (
          <Link
            key={id}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2 flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
              active
                ? "bg-[#E07200] text-white"
                : "text-slate-500 hover:text-slate-800 hover:bg-slate-50"
            )}
          >
            <Icon size={14} />
            {label}
          </Link>
        );
      })}
    </div>
  );
}
