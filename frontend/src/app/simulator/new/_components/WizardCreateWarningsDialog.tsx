"use client";

import { CircleNotch, Info, Package, Warning } from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { WizardCreateWarning, WizardWarningKind } from "./wizard-draft";

interface Props {
  open: boolean;
  warnings: WizardCreateWarning[];
  saving?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

const KIND_STYLES: Record<
  WizardWarningKind,
  {
    border: string;
    bg: string;
    iconBg: string;
    iconColor: string;
    label: string;
    Icon: Icon;
  }
> = {
  params: {
    border: "border-l-warm",
    bg: "bg-warm/10",
    iconBg: "bg-warm/20",
    iconColor: "text-warm",
    label: "Paramètres",
    Icon: Warning,
  },
  "sku-empty": {
    border: "border-l-primary",
    bg: "bg-primary/5",
    iconBg: "bg-primary/15",
    iconColor: "text-primary",
    label: "Catalogue",
    Icon: Info,
  },
  "sku-not-found": {
    border: "border-l-destructive",
    bg: "bg-destructive/5",
    iconBg: "bg-destructive/15",
    iconColor: "text-destructive",
    label: "Import",
    Icon: Package,
  },
};

function WarningCard({ warning, index }: { warning: WizardCreateWarning; index: number }) {
  const style = KIND_STYLES[warning.kind];
  const KindIcon = style.Icon;

  return (
    <article
      className={cn(
        "flex gap-3 rounded-lg border border-border/80 border-l-4 p-3.5 shadow-sm",
        style.border,
        style.bg,
      )}
    >
      <div className="flex shrink-0 flex-col items-center gap-1">
        <span
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-full",
            style.iconBg,
          )}
        >
          <KindIcon size={18} weight="duotone" className={style.iconColor} aria-hidden />
        </span>
        <span className="text-[10px] font-bold tabular-nums text-muted-foreground">{index}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
              style.iconBg,
              style.iconColor,
            )}
          >
            {style.label}
          </span>
          <span className="text-xs font-semibold text-foreground">{warning.title}</span>
        </div>
        <p className="mt-1.5 text-sm leading-relaxed text-foreground/90">{warning.message}</p>
      </div>
    </article>
  );
}

export function WizardCreateWarningsDialog({
  open,
  warnings,
  saving = false,
  onCancel,
  onConfirm,
}: Props) {
  const close = () => {
    if (!saving) onCancel();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-w-xl gap-0 overflow-hidden p-0" showCloseButton={!saving}>
        <div className="border-b border-warm/25 bg-gradient-to-br from-warm/15 via-warm/5 to-transparent px-5 py-4">
          <DialogHeader className="gap-0 p-0 text-left">
            <DialogTitle className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-warm/20 ring-4 ring-warm/10">
                <Warning size={24} weight="duotone" className="text-warm" />
              </span>
              <span className="min-w-0 pt-0.5">
                <span className="block text-base font-bold text-foreground">
                  Créer malgré les avertissements ?
                </span>
                <span className="mt-1 block text-sm font-normal text-muted-foreground">
                  {warnings.length} point{warnings.length > 1 ? "s" : ""} peut
                  {warnings.length > 1 ? "vent" : ""} empêcher un calcul correct.
                </span>
              </span>
            </DialogTitle>
          </DialogHeader>
        </div>

        <div className="flex max-h-[min(52vh,360px)] flex-col gap-2.5 overflow-y-auto bg-muted/20 p-4">
          {warnings.map((warning, index) => (
            <WarningCard key={warning.id} warning={warning} index={index + 1} />
          ))}
        </div>

        <div className="border-t border-border bg-card px-5 py-3">
          <p className="text-sm text-muted-foreground">
            Vous pouvez revenir corriger ces points, ou confirmer pour créer la simulation telle
            quelle.
          </p>
        </div>

        <DialogFooter className="border-t border-border bg-card">
          <Button type="button" variant="outline" onClick={close} disabled={saving}>
            Revenir corriger
          </Button>
          <Button type="button" onClick={onConfirm} disabled={saving} className="gap-2">
            {saving && <CircleNotch size={15} className="animate-spin" />}
            Créer quand même
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
