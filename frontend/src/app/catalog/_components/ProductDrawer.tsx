"use client";

import { uiDateLocale } from "@/lib/i18n";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { ArrowUpRight, Copy, X } from "@phosphor-icons/react";
import {
  getProduct,
  getProductAttributes,
  type ProductAttributeValue,
  type ProductDetail,
} from "@/lib/api";
import { useUiTranslate } from "@/lib/use-ui-translate";
import { cn } from "@/lib/utils";
import { productUnitLabel } from "@/lib/product-units";
import { useAuth } from "@/contexts/AuthContext";
import { canEdit } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { buildDuplicateDraft, seedProductDraft } from "../new/draft";

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
  const router = useRouter();
  const t = useUiTranslate();
  const { role, displayLanguage } = useAuth();
  const userCanEdit = canEdit(role);

  const { data, isLoading, error } = useSWR<ProductDetail>(
    sku ? ["product-drawer", sku] : null,
    () => getProduct(sku as string),
  );
  // Attribute values are only needed to seed a duplication (edit users).
  const { data: attrs } = useSWR<ProductAttributeValue[]>(
    sku && userCanEdit ? ["product-drawer-attrs", sku] : null,
    () => getProductAttributes(sku as string),
  );

  const activeSupplier = data?.suppliers?.find((s) => s.is_active)?.supplier_name;

  // Duplicate from the catalog row (FEEDBACK 1) — same flow as the fiche.
  const handleDuplicate = () => {
    if (!data) return;
    seedProductDraft(buildDuplicateDraft(data, attrs ?? []));
    toast.success(t("catalog.duplicate.toast"));
    router.push("/catalog/new");
  };

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
              <Button type="button" variant="ghost" size="icon-sm" aria-label={t("common.close")}>
                <X size={20} />
              </Button>
            </Dialog.Close>
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            {error ? (
              <p className="text-sm text-destructive">{t("catalog.drawer.loadError")}</p>
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
                <Row label={t("catalog.column.universe")} value={data.universe} />
                <Row label={t("catalog.column.family")} value={data.family} />
                <Row label={t("catalog.column.range")} value={data.range} />
                <Row label={t("catalog.column.subRange")} value={data.sub_range} />
                <Row label={t("catalog.column.brand")} value={data.brand} />
                <Row label={t("catalog.column.activeSupplier")} value={activeSupplier} />
                <Row
                  label={t("catalog.column.pamp")}
                  value={
                    data.pamp_eur ? (
                      <span className="font-mono tabular-nums text-primary">
                        {parseFloat(data.pamp_eur).toLocaleString(uiDateLocale(displayLanguage), {
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
                  label={t("catalog.column.stock")}
                  value={
                    data.stock_quantity != null
                      ? `${Math.round(parseFloat(data.stock_quantity))} ${productUnitLabel(data)}`
                      : "—"
                  }
                />
                {localize(data.description_marketing) && (
                  <div className="mt-4">
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t("catalog.drawer.description")}
                    </p>
                    <p className="line-clamp-6 text-sm text-muted-foreground">
                      {localize(data.description_marketing)}
                    </p>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="flex gap-2 border-t border-border p-5">
            {sku && (
              <Button
                nativeButton={false}
                render={<Link href={`/catalog/${encodeURIComponent(sku)}`} />}
                className="flex-1"
              >
                {t("catalog.drawer.open")}
                <ArrowUpRight size={16} />
              </Button>
            )}
            {userCanEdit && data && (
              <Button variant="outline" onClick={handleDuplicate} title={t("catalog.action.duplicateTitle")}>
                <Copy size={16} />
                {t("catalog.action.duplicate")}
              </Button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
