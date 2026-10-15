"use client";

import { Warning } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { useUiTranslate } from "@/lib/use-ui-translate";

interface Props {
  issues: string[];
  className?: string;
}

/** Liste les paramètres manquants ou invalides sur l'étape 3 du wizard. */
export function WizardStep3IssuesBanner({ issues, className }: Props) {
  const t = useUiTranslate();
  if (issues.length === 0) return null;

  return (
    <div
      className={cn(
        "rounded-xl border border-warm/40 bg-warm/10 px-4 py-3 shadow-sm",
        className,
      )}
      role="alert"
    >
      <div className="flex items-start gap-3">
        <Warning size={20} weight="duotone" className="mt-0.5 shrink-0 text-warm" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            {issues.length > 1
              ? t("simulator.wizard.issuesOther", { count: issues.length })
              : t("simulator.wizard.issuesOne", { count: issues.length })}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("simulator.wizard.issuesHint")}
          </p>
          <ul className="mt-2.5 list-disc space-y-1 pl-4 text-sm text-foreground/90">
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
