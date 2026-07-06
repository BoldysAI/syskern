"use client";

import { CaretRight, Check } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

export interface WizardStep {
  label: string;
  /** Show the step in an error state (red badge). */
  hasError?: boolean;
}

interface WizardStepperProps {
  steps: WizardStep[];
  /** 0-based index of the current step. */
  current: number;
  /** When provided, steps are clickable (jump to a step). */
  onStepClick?: (index: number) => void;
  className?: string;
}

/**
 * Shared wizard progress bar — used by the product wizard (`catalog/new`) and the
 * offer wizards (`offers/new-project`, `offers/new-tariff`) so they share the same
 * look & feel. Clickable steps (number/check badge, active/done/error states,
 * caret separators).
 */
export function WizardStepper({ steps, current, onStepClick, className }: WizardStepperProps) {
  const clickable = Boolean(onStepClick);

  return (
    <ol className={cn("mb-6 flex items-center gap-2 overflow-x-auto", className)}>
      {steps.map((s, idx) => {
        const active = idx === current;
        const done = idx < current;
        return (
          <li key={idx} className="flex flex-shrink-0 items-center gap-2">
            <button
              type="button"
              disabled={!clickable}
              onClick={() => onStepClick?.(idx)}
              className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : done
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground",
                clickable && !active ? "hover:bg-muted" : "cursor-default",
              )}
            >
              <span
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full text-xs",
                  active
                    ? "bg-primary-foreground/20"
                    : done
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground",
                  s.hasError && "bg-destructive text-destructive-foreground",
                )}
              >
                {done ? <Check size={12} weight="bold" /> : idx + 1}
              </span>
              {s.label}
            </button>
            {idx < steps.length - 1 && (
              <CaretRight size={14} className="text-muted-foreground/40" />
            )}
          </li>
        );
      })}
    </ol>
  );
}
