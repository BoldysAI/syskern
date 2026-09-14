import { HELP_TITLE } from "@/lib/help";
import { cn } from "@/lib/utils";

interface HelpGuideEmbedProps {
  className?: string;
  title?: string;
}

/** Placeholder guide — the production Notion embed is client-branded. */
export function HelpGuideEmbed({
  className,
  title = HELP_TITLE,
}: HelpGuideEmbedProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-start justify-center gap-2 bg-card p-8 text-sm text-muted-foreground",
        className,
      )}
    >
      <p className="text-base font-semibold text-foreground">{title}</p>
      <p>
        Documentation interne : catalogue, simulations, comparaisons et offres.
        Parcourez les écrans de la plateforme pour le parcours pricing.
      </p>
    </div>
  );
}
