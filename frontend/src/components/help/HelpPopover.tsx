"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowRight, BookOpenText, Question } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Header entry point: compact help popover → dedicated `/help` guide page.
 */
export function HelpPopover() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const onHelpPage = pathname === "/help" || pathname.startsWith("/help/");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Aide"
            title="Aide"
            className={cn(onHelpPage && "bg-muted text-foreground")}
          />
        }
      >
        <Question size={20} weight={onHelpPage ? "fill" : "bold"} />
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-80 gap-0 p-0">
        <div className="border-b border-border bg-gradient-to-br from-primary/10 to-transparent px-4 py-3.5">
          <PopoverHeader>
            <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <BookOpenText size={20} weight="duotone" />
            </div>
            <PopoverTitle className="text-base font-semibold text-foreground">
              Aide
            </PopoverTitle>
            <PopoverDescription className="mt-1 text-xs leading-relaxed">
              Guide utilisateur, parcours pricing et bonnes pratiques.
            </PopoverDescription>
          </PopoverHeader>
        </div>
        <div className="p-3">
          <Button
            className="w-full justify-between gap-2"
            size="sm"
            onClick={() => {
              setOpen(false);
              router.push("/help");
            }}
          >
            Ouvrir le guide
            <ArrowRight size={14} />
          </Button>
          {onHelpPage && (
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              Vous consultez déjà le guide.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
