"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { AppIconCircle } from "@/components/AppIcon";
import { Skeleton } from "@/components/ui/skeleton";
import type { IconProps } from "@phosphor-icons/react";

export interface DashboardKpiItem {
  label: string;
  value: React.ReactNode;
  subValue?: string;
  href: string;
  icon: React.ComponentType<IconProps>;
  tone: "primary" | "warm" | "blue" | "navy";
}

interface DashboardKpiGridProps {
  items: DashboardKpiItem[];
  loading?: boolean;
}

export function DashboardKpiGrid({ items, loading }: DashboardKpiGridProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cn(
            "group flex items-start gap-3 rounded-xl border bg-card p-4 shadow-[var(--shadow-soft)] transition-all duration-200",
            "motion-safe:hover:-translate-y-0.5 motion-safe:hover:shadow-[var(--shadow-card)]",
          )}
        >
          <AppIconCircle
            icon={item.icon}
            tone={item.tone}
            weight="duotone"
            size="md"
            className="shrink-0"
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-muted-foreground">{item.label}</p>
            <p className="mt-0.5 text-2xl font-bold tabular-nums text-foreground">{item.value}</p>
            {item.subValue && (
              <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{item.subValue}</p>
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}
