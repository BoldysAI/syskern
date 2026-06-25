"use client";

import Link from "next/link";
import useSWR from "swr";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowUpRight, X } from "@phosphor-icons/react";
import { getProduct, type ProductDetail } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

function localize(desc?: Record<string, string>): string {
  if (!desc) return "";
  return desc.fr || desc.en || desc.es || "";
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-foreground">{value || "—"}</span>
    </div>
  );
}

/** Slide-over quick view for a product (CDC §4.3, Écran 1). */
export function ProductDrawer({ sku, onClose }: { sku: string | null; onClose: () => void }) {
  const { data, isLoading, error } = useSWR<ProductDetail>(
    sku ? ["product-drawer", sku] : null,
    () => getProduct(sku as string),
  );

  const activeSupplier = data?.suppliers?.find((s) => s.is_active)?.supplier_name;

  return (
    <Dialog.Root open={!!sku} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30" />
        <Dialog.Content
          className={cn(
            "fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col bg-card shadow-[var(--shadow-elevated)]",
            "focus:outline-none data-[state=open]:animate-in",
          )}
        >
          <div className="flex items-center justify-between border-b border-border p-5">
            <Dialog.Title className="truncate font-mono text-base font-semibold text-foreground">
              {sku}
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Fermer">
                <X size={20} />
              </Button>
            </Dialog.Close>
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            {error ? (
              <p className="text-sm text-destructive">Impossible de charger le produit.</p>
            ) : isLoading || !data ? (
              <div className="space-y-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-5 w-full" />
                ))}
              </div>
            ) : (
              <>
                <Dialog.Description className="mb-4 text-base font-semibold text-foreground">
                  {data.name}
                </Dialog.Description>
                <Row label="Univers" value={data.universe} />
                <Row label="Famille" value={data.family} />
                <Row label="Gamme" value={data.range} />
                <Row label="Sous-gamme" value={data.sub_range} />
                <Row label="Marque" value={data.brand} />
                <Row label="Fournisseur actif" value={activeSupplier} />
                <Row
                  label="PAMP"
                  value={
                    data.pamp_eur ? (
                      <span className="font-mono tabular-nums text-primary">
                        {parseFloat(data.pamp_eur).toLocaleString("fr-FR", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{" "}
                        €
                      </span>
                    ) : (
                      "—"
                    )
                  }
                />
                <Row
                  label="Stock"
                  value={
                    data.stock_quantity != null
                      ? Math.round(parseFloat(data.stock_quantity))
                      : "—"
                  }
                />
                {localize(data.description_marketing) && (
                  <div className="mt-4">
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Description
                    </p>
                    <p className="line-clamp-6 text-sm text-muted-foreground">
                      {localize(data.description_marketing)}
                    </p>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="border-t border-border p-5">
            {sku && (
              <Button nativeButton={false} render={<Link href={`/catalog/${encodeURIComponent(sku)}`} />} className="w-full">
                Ouvrir la fiche complète
                <ArrowUpRight size={16} />
              </Button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
