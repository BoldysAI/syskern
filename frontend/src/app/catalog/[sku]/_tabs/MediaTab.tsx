"use client";

import { Image as ImageIcon } from "@phosphor-icons/react";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";

export function MediaTab() {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center gap-3 p-12 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
          <ImageIcon size={26} weight="duotone" className="text-muted-foreground" aria-hidden />
        </div>
        <p className="text-sm font-semibold text-foreground">Médias</p>
        <StatusBadge variant="warning">Disponible en MVP2</StatusBadge>
        <p className="max-w-xs text-xs text-muted-foreground">
          La gestion des images et documents produits sera disponible dans une prochaine version.
        </p>
      </CardContent>
    </Card>
  );
}
