"use client";

/**
 * Split-button recalcul (FEEDBACK 2) : clic principal = params_only immédiat ;
 * menu déroulant = scopes avancés (Odoo / full refresh).
 */

import { useState } from "react";
import {
  Calculator,
  CaretDown,
  CircleNotch,
  Database,
  ArrowsClockwise,
} from "@phosphor-icons/react";
import { recalculateSimulation, type RecalcScope } from "@/lib/api";
import { humanizeApiError } from "@/lib/humanize-errors";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { useUiTranslate } from "@/lib/use-ui-translate";
import type { MessageKey } from "@/lib/i18n";

interface Props {
  simId: string;
  marketParams?: Record<string, unknown>;
  disabled?: boolean;
  /** Highlight when simulation is dirty (recalc needed). */
  isDirty?: boolean;
  onDone: () => void;
}

const ADVANCED_SCOPES: {
  id: Exclude<RecalcScope, "params_only">;
  label: MessageKey;
  description: MessageKey;
  icon: typeof ArrowsClockwise;
}[] = [
  {
    id: "with_odoo_refresh",
    label: "simulator.recalc.odooScope",
    description: "simulator.recalc.odooScopeHint",
    icon: ArrowsClockwise,
  },
  {
    id: "full_refresh",
    label: "simulator.recalc.fullScope",
    description: "simulator.recalc.fullScopeHint",
    icon: Database,
  },
];

export function RecalculateButton({
  simId,
  marketParams,
  disabled,
  isDirty,
  onDone,
}: Props) {
  const t = useUiTranslate();
  const [running, setRunning] = useState(false);

  const run = async (scope: RecalcScope) => {
    setRunning(true);
    try {
      const result = await recalculateSimulation(simId, {
        scope,
        market_params: marketParams as Record<string, string> | undefined,
      });
      onDone();
      if (result?.odoo_refresh_error) {
        toast.warning(
          t("simulator.recalc.odooUnavailable", { error: result.odoo_refresh_error }),
        );
      } else {
        toast.success(t("simulator.recalc.done"));
      }
    } catch (e) {
      toast.error(humanizeApiError(e, t("simulator.recalc.failed")));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="inline-flex items-stretch">
      <Button
        type="button"
        onClick={() => void run("params_only")}
        disabled={disabled || running}
        variant={isDirty ? "default" : "outline"}
        size="sm"
        className={cn("gap-2 rounded-r-none border-r-0 font-semibold")}
      >
        {running ? (
          <CircleNotch size={15} className="animate-spin" />
        ) : (
          <Calculator size={15} />
        )}
        {t("simulator.recalc.button")}
        {isDirty && !running && (
          <span
            className="h-2 w-2 rounded-full bg-primary-foreground"
            title={t("simulator.status.dirty")}
          />
        )}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={disabled || running}
          render={
            <Button
              type="button"
              variant={isDirty ? "default" : "outline"}
              size="sm"
              className="rounded-l-none px-2"
              aria-label={t("simulator.recalc.advancedAria")}
              title={t("simulator.recalc.advancedTitle")}
            />
          }
        >
          <CaretDown size={14} weight="bold" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-72">
          {ADVANCED_SCOPES.map((s) => {
            const Icon = s.icon;
            return (
              <DropdownMenuItem
                key={s.id}
                disabled={running}
                onClick={() => void run(s.id)}
                className="flex items-start gap-2.5 py-2"
              >
                <Icon size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
                <span>
                  <span className="block text-sm font-medium">{t(s.label)}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {t(s.description)}
                  </span>
                </span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
