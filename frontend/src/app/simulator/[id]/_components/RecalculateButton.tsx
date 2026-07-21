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
  label: string;
  description: string;
  icon: typeof ArrowsClockwise;
}[] = [
  {
    id: "with_odoo_refresh",
    label: "Rafraîchir Odoo + recalcul",
    description: "Stock, PAMP et achats engagés depuis Odoo, puis recalcul.",
    icon: ArrowsClockwise,
  },
  {
    id: "full_refresh",
    label: "Rafraîchissement complet",
    description: "Paramètres marché actifs + Odoo, puis recalcul.",
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
          `Recalcul effectué sur les paramètres courants. Rafraîchissement Odoo indisponible : ${result.odoo_refresh_error}`,
        );
      } else {
        toast.success("Recalcul terminé");
      }
    } catch (e) {
      toast.error(humanizeApiError(e, "Recalcul échoué."));
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
        Recalculer
        {isDirty && !running && (
          <span
            className="h-2 w-2 rounded-full bg-primary-foreground"
            title="Recalcul nécessaire"
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
              aria-label="Options de recalcul avancées"
              title="Options avancées"
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
                  <span className="block text-sm font-medium">{s.label}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {s.description}
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
