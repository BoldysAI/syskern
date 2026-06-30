"use client";

import Link from "next/link";
import { ArrowRight, Calculator, ChartLineUp, FileText } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";

const STEPS = [
  {
    step: 1,
    title: "Explorer le catalogue",
    description: "Parcourez les SKU et vérifiez les données produit.",
    href: "/catalog",
    icon: Calculator,
  },
  {
    step: 2,
    title: "Créer une simulation",
    description: "Sélectionnez des produits et lancez le calcul de pricing.",
    href: "/simulator/new",
    icon: ChartLineUp,
  },
  {
    step: 3,
    title: "Générer une offre",
    description: "Finalisez une simulation puis créez une offre tarif ou projet.",
    href: "/offers",
    icon: FileText,
  },
] as const;

export function DashboardOnboarding() {
  return (
    <section className="rounded-xl border border-dashed border-primary/30 bg-gradient-to-br from-primary/5 to-card p-6 shadow-[var(--shadow-soft)]">
      <h2 className="text-lg font-semibold text-foreground">Bienvenue sur Syskern</h2>
      <p className="mt-1 max-w-xl text-sm text-muted-foreground">
        Commencez par ces trois étapes pour prendre en main la plateforme de pricing.
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
            <p className="mt-2 text-sm font-semibold text-foreground">{s.title}</p>
            <p className="mt-1 flex-1 text-xs text-muted-foreground">{s.description}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 gap-1 self-start"
              nativeButton={false}
              render={<Link href={s.href} />}
            >
              Commencer
              <ArrowRight size={14} />
            </Button>
          </li>
        ))}
      </ol>
    </section>
  );
}
