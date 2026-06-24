"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { AppIcon } from "@/components/AppIcon";
import { Skeleton } from "@/components/ui/skeleton";
import type { IconProps } from "@phosphor-icons/react";

export interface QuickActionItem {
  label: string;
  description: string;
  href: string;
  icon: React.ComponentType<IconProps>;
}

interface DashboardQuickActionsProps {
  items: QuickActionItem[];
  loading?: boolean;
}

export function DashboardQuickActions({ items, loading }: DashboardQuickActionsProps) {
  if (loading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cn(
            "group flex items-start gap-3 rounded-xl border bg-card p-4 shadow-[var(--shadow-soft)] transition-colors duration-200",
            "hover:border-primary/30 hover:shadow-[var(--shadow-soft)]",
          )}
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
            <AppIcon icon={item.icon} weight="duotone" size="md" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{item.label}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{item.description}</p>
          </div>
        </Link>
      ))}
    </div>
  );
}
