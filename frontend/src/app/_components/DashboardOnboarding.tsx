"use client";

import Link from "next/link";
import { ArrowRight, Calculator, ChartLineUp, FileText } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import type { MessageKey } from "@/lib/i18n";
import { useUiTranslate } from "@/lib/use-ui-translate";

const STEPS: {
  step: number;
  titleKey: MessageKey;
  descriptionKey: MessageKey;
  href: string;
  icon: typeof Calculator;
}[] = [
  {
    step: 1,
    titleKey: "dashboard.stepCatalog",
    descriptionKey: "dashboard.stepCatalogDesc",
    href: "/catalog",
    icon: Calculator,
  },
  {
    step: 2,
    titleKey: "dashboard.stepSimulation",
    descriptionKey: "dashboard.stepSimulationDesc",
    href: "/simulator/new",
    icon: ChartLineUp,
  },
  {
    step: 3,
    titleKey: "dashboard.stepOffer",
    descriptionKey: "dashboard.stepOfferDesc",
    href: "/offers",
    icon: FileText,
  },
];

export function DashboardOnboarding() {
  const t = useUiTranslate();
  return (
    <section className="rounded-xl border border-dashed border-primary/30 bg-gradient-to-br from-primary/5 to-card p-6 shadow-[var(--shadow-soft)]">
      <h2 className="text-lg font-semibold text-foreground">{t("dashboard.welcome")}</h2>
      <p className="mt-1 max-w-xl text-sm text-muted-foreground">
        {t("dashboard.welcomeLead")}
      </p>
      <ol className="mt-5 grid gap-3 sm:grid-cols-3">
        {STEPS.map((s) => (
          <li
            key={s.step}
            className="flex flex-col rounded-xl border border-border bg-card p-4"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
              {s.step}
            </span>
            <s.icon size={22} className="mt-3 text-primary" weight="duotone" />
            <p className="mt-2 text-sm font-semibold text-foreground">{t(s.titleKey)}</p>
            <p className="mt-1 flex-1 text-xs text-muted-foreground">{t(s.descriptionKey)}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 gap-1 self-start"
              nativeButton={false}
              render={<Link href={s.href} />}
            >
              {t("dashboard.start")}
              <ArrowRight size={14} />
            </Button>
          </li>
        ))}
      </ol>
    </section>
  );
}
