"use client";

import { useState, type ReactNode } from "react";
import type { IconProps } from "@phosphor-icons/react";
import { CaretDown } from "@phosphor-icons/react";
import * as Collapsible from "@radix-ui/react-collapsible";
import { cn } from "@/lib/utils";
import { AppIcon } from "@/components/AppIcon";

interface FilterSectionProps {
  title: string;
  icon?: React.ComponentType<IconProps>;
  activeCount?: number;
  /**
   * Sections repliables : fermées par défaut sur toute la plateforme.
   * Seule exception validée : l'arborescence produit du catalogue, que le client
   * utilise à chaque recherche (FEEDBACK 2). Ne pas étendre sans demande explicite.
   */
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}

export function FilterSection({
  title,
  icon,
  activeCount = 0,
  defaultOpen = false,
  children,
  className,
}: FilterSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [hasOpened, setHasOpened] = useState(defaultOpen);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) setHasOpened(true);
  };

  return (
    <Collapsible.Root
      open={open}
      onOpenChange={handleOpenChange}
      className={cn("border-b border-border", className)}
    >
      <Collapsible.Trigger className="flex w-full items-center gap-2.5 px-4 py-3.5 text-left transition-colors hover:bg-muted/40">
        {icon && (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <AppIcon icon={icon} weight="duotone" size="sm" />
          </span>
        )}
        <span className="flex-1 text-sm font-semibold text-foreground">{title}</span>
        {activeCount > 0 && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground tabular-nums">
            {activeCount}
          </span>
        )}
        <CaretDown
          size={14}
          className={cn(
            "shrink-0 text-muted-foreground transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </Collapsible.Trigger>
      <Collapsible.Content className="overflow-hidden px-4 pb-4 data-[state=closed]:hidden">
        {hasOpened ? children : null}
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
