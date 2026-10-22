"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react";
import { loadLastVisited, type LastVisited } from "@/lib/last-visited";
import { Button } from "@/components/ui/button";
import { useUiTranslate } from "@/lib/use-ui-translate";

export function DashboardResumeCard() {
  const t = useUiTranslate();
  const [entry] = useState<LastVisited | null>(() =>
    typeof window !== "undefined" ? loadLastVisited() : null,
  );

  if (!entry) return null;

  return (
    <section className="rounded-xl border border-primary/20 bg-primary/5 p-4 shadow-[var(--shadow-soft)]">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t("dashboard.resume")}
      </p>
      <p className="mt-1 truncate text-sm font-semibold text-foreground">{entry.label}</p>
      <Button
        className="mt-3 gap-2"
        size="sm"
        nativeButton={false}
        render={<Link href={entry.path} />}
      >
        {t("dashboard.continue")}
        <ArrowRight size={14} />
      </Button>
    </section>
  );
}
