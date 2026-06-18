"use client";

import Link from "next/link";
import useSWR from "swr";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowUpRight, X } from "lucide-react";
import { getProduct, type ProductDetail } from "@/lib/api";
import { cn } from "@/lib/utils";

function localize(desc?: Record<string, string>): string {
  if (!desc) return "";
  return desc.fr || desc.en || desc.es || "";
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2 border-b border-[#F1F5F9] text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-800 text-right">{value || "—"}</span>
    </div>
  );
}

/** Slide-over quick view for a product (CDC §4.3, Écran 1). */
export function ProductDrawer({ sku, onClose }: { sku: string | null; onClose: () => void }) {
  const { data, isLoading, error } = useSWR<ProductDetail>(
    sku ? ["product-drawer", sku] : null,
    () => getProduct(sku as string)
  );

  const activeSupplier = data?.suppliers?.find((s) => s.is_active)?.supplier_name;

  return (
    <Dialog.Root open={!!sku} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30" />
        <Dialog.Content
          className={cn(
            "fixed right-0 top-0 z-50 h-full w-full max-w-md bg-white shadow-2xl",
            "flex flex-col focus:outline-none data-[state=open]:animate-in"
          )}
        >
          <div className="flex items-center justify-between p-5 border-b border-[#E2E8F0]">
            <Dialog.Title className="text-base font-semibold text-slate-900 font-mono truncate">
              {sku}
            </Dialog.Title>
            <Dialog.Close className="text-slate-400 hover:text-slate-600" aria-label="Fermer">
              <X size={20} />
            </Dialog.Close>
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            {error ? (
              <p className="text-sm text-red-600">Impossible de charger le produit.</p>
            ) : isLoading || !data ? (
              <div className="space-y-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-5 animate-pulse rounded bg-slate-100" />
                ))}
              </div>
            ) : (
              <>
                <Dialog.Description className="text-base font-semibold text-slate-900 mb-4">
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
                    data.pamp_eur
                      ? `${parseFloat(data.pamp_eur).toLocaleString("fr-FR", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })} €`
                      : "—"
                  }
                />
                <Row
                  label="Stock"
                  value={data.stock_quantity != null ? Math.round(parseFloat(data.stock_quantity)) : "—"}
                />
                {localize(data.description_marketing) && (
                  <div className="mt-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
                      Description
                    </p>
                    <p className="text-sm text-slate-700 line-clamp-6">
                      {localize(data.description_marketing)}
                    </p>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="p-5 border-t border-[#E2E8F0]">
            {sku && (
              <Link
                href={`/catalog/${encodeURIComponent(sku)}`}
                className="flex items-center justify-center gap-2 w-full py-2.5 text-sm font-semibold text-white bg-[#E07200] rounded-lg hover:bg-[#C56400] transition-colors"
              >
                Ouvrir la fiche complète
                <ArrowUpRight size={16} />
              </Link>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
