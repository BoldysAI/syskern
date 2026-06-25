"use client";

import { useCallback, useMemo, useState, Suspense, type ReactNode } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import {
  ArrowSquareOut,
  ArrowsClockwise,
  Check,
  ClockCounterClockwise,
  Package,
  PencilSimple,
  Plus,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  deleteProduct,
  getAttributeRegistry,
  getPriceHistory,
  getProduct,
  getProductAttributes,
  refreshPamp,
  setProductAttribute,
  translateProduct,
  updateProduct,
  type AttributeCategory,
  type AttributeRegistry,
  type ProductAttributeValue,
  type ProductDetail,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/ConfirmProvider";
import { toast } from "sonner";
import { BrandLogo } from "@/components/BrandLogo";
import { KpiCard } from "@/components/KpiCard";
import { StatusBadge } from "@/components/StatusBadge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { canEdit } from "@/lib/auth";
import { useAutosave } from "@/hooks/useAutosave";
import {
  useBreadcrumbOverride,
  type BreadcrumbCrumb,
} from "@/components/layout/BreadcrumbContext";
import { AddToSimulationDialog } from "@/components/AddToSimulationDialog";
import { EditContext, type EditContextValue, type DescriptionKind } from "./_tabs/edit-context";
import { GeneralTab } from "./_tabs/GeneralTab";
import { TechnicalTab } from "./_tabs/TechnicalTab";
import { MarketingTab } from "./_tabs/MarketingTab";
import { LogisticsTab } from "./_tabs/LogisticsTab";
import { CommercialTab } from "./_tabs/CommercialTab";
import { collapsePriceHistoryByDay } from "./_tabs/price-history-chart";
import { MediaTab } from "./_tabs/MediaTab";

const ODOO_BASE_URL = process.env.NEXT_PUBLIC_ODOO_BASE_URL ?? "";

const DESC_FIELD: Record<DescriptionKind, keyof ProductDetail> = {
  marketing: "description_marketing",
  technical: "description_technical",
};

function parseDec(v?: string | null): number {
  return v != null ? parseFloat(v) : 0;
}

function SkeletonBlock({ className }: { className?: string }) {
  return <Skeleton className={cn("rounded", className)} />;
}

function eq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function mergeAttrValues(
  current: ProductAttributeValue[],
  updated: ProductAttributeValue[],
): ProductAttributeValue[] {
  const byAttr = new Map(current.map((v) => [v.attribute, v]));
  for (const u of updated) byAttr.set(u.attribute, u);
  return Array.from(byAttr.values());
}

function buildOdooUrl(odooId?: number | null): string | null {
  if (!ODOO_BASE_URL || odooId == null) return null;
  return `${ODOO_BASE_URL.replace(/\/$/, "")}/web#id=${odooId}&model=product.template`;
}

// ─── Left column: key info card ─────────────────────────────────────────────

function InfoLine({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border py-2 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}

function KeyInfoCard({ product, latestPv }: { product: ProductDetail; latestPv: number }) {
  const pamp = parseDec(product.pamp_eur);
  const stock = parseDec(product.stock_quantity);
  const hierarchy = [product.universe, product.family, product.range, product.sub_range]
    .filter(Boolean)
    .join(" › ");

  return (
    <Card className="lg:sticky lg:top-6 shadow-sm">
      <CardContent className="p-5">
      <div className="mb-4 flex aspect-square w-full items-center justify-center rounded-lg bg-muted">
        <Package size={48} weight="duotone" className="text-muted-foreground/40" />
      </div>

      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h1 className="font-mono text-lg font-bold text-primary">{product.sku_code}</h1>
        <StatusBadge variant={product.is_active ? "success" : "draft"}>
          {product.is_active ? "Actif" : "Inactif"}
        </StatusBadge>
      </div>
      <p className="text-sm text-muted-foreground mb-4">{product.name}</p>

      {product.brand?.toLowerCase() === "unikkern" && (
        <div className="mb-4 flex justify-center p-3">
          <BrandLogo variant="unnikkern" className="h-8 min-w-0" />
        </div>
      )}

      <InfoLine label="Hiérarchie" value={hierarchy || <span className="text-muted-foreground/50">—</span>} />
      <InfoLine label="Marque" value={product.brand || <span className="text-muted-foreground/50">—</span>} />
      <InfoLine label="Stock" value={`${Math.round(stock)} u`} />

      <div className="mt-4 grid grid-cols-1 gap-2">
        <KpiCard
          label="PAMP"
          accent="green"
          value={
            pamp > 0
              ? `${pamp.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
              : "—"
          }
        />
        <KpiCard
          label="Prix de vente actuel"
          accent="green"
          value={
            latestPv > 0
              ? `${latestPv.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
              : "—"
          }
        />
      </div>
      </CardContent>
    </Card>
  );
}

// ─── Save status indicator (CDC §4.3) ───────────────────────────────────────

function SaveIndicator({
  status,
  error,
}: {
  status: "idle" | "saving" | "saved" | "error";
  error: string | null;
}) {
  if (error) {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-sm font-medium text-destructive"
        title={error}
      >
        <WarningCircle size={15} weight="duotone" />
        Erreur de sauvegarde
      </span>
    );
  }
  if (status === "saving") {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-warm">
        <ArrowsClockwise size={15} className="animate-spin" />
        Modifications en cours…
      </span>
    );
  }
  if (status === "saved") {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-green">
        <Check size={15} weight="bold" />
        Enregistré
      </span>
    );
  }
  return null;
}

const TABS = [
  { id: "general", label: "Général" },
  { id: "technical", label: "Technique" },
  { id: "marketing", label: "Marketing" },
  { id: "logistics", label: "Logistique" },
  { id: "commercial", label: "Commercial" },
  { id: "media", label: "Médias" },
];

export default function ProductPage() {
  return (
    <Suspense fallback={<ProductPageSkeleton />}>
      <ProductPageContent />
    </Suspense>
  );
}

function ProductPageSkeleton() {
  return (
    <div className="p-6">
      <SkeletonBlock className="mb-6 h-8 w-48" />
      <SkeletonBlock className="h-64 w-full" />
    </div>
  );
}

function ProductPageContent() {
  const confirm = useConfirm();
  const params = useParams<{ sku: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const decodedSku = decodeURIComponent(params?.sku ?? "");
  const { role } = useAuth();
  const userCanEdit = canEdit(role);

  const productKey = useMemo(() => (decodedSku ? ["product", decodedSku] : null), [decodedSku]);
  const attrsKey = useMemo(() => (decodedSku ? ["product-attrs", decodedSku] : null), [decodedSku]);
  const { mutate } = useSWRConfig();

  const {
    data: product,
    isLoading,
    error,
  } = useSWR<ProductDetail>(productKey, () => getProduct(decodedSku));
  const { data: attrsData } = useSWR<ProductAttributeValue[]>(attrsKey, () =>
    getProductAttributes(decodedSku),
  );
  const { data: registry } = useSWR<AttributeRegistry[]>("attr-registry", () =>
    getAttributeRegistry(),
  );
  const { data: history6m } = useSWR(decodedSku ? ["price-history", decodedSku, "6m"] : null, () =>
    getPriceHistory(decodedSku, "6m"),
  );
  const latestPv = useMemo(() => {
    const points = collapsePriceHistoryByDay(history6m?.points ?? []);
    return points.length ? parseDec(points[points.length - 1].pv_eur) : 0;
  }, [history6m?.points]);

  const wantEdit =
    searchParams.get("edit") === "1" || searchParams.get("edit") === "true";
  const tabParam = searchParams.get("tab");
  const initialTab = TABS.some((tab) => tab.id === tabParam) ? tabParam! : "general";

  const [manualEditing, setManualEditing] = useState<boolean | null>(null);
  const [activeTab, setActiveTab] = useState(initialTab);
  const [coreDraft, setCoreDraft] = useState<Record<string, unknown>>({});
  const [attrDraft, setAttrDraft] = useState<Record<string, unknown>>({});
  const [fieldValidity, setFieldValidity] = useState<Record<string, boolean>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [recalcing, setRecalcing] = useState(false);
  const [translating, setTranslating] = useState<"en" | "es" | null>(null);
  const [deleting, setDeleting] = useState(false);

  const editing = manualEditing ?? (wantEdit && userCanEdit && Boolean(product));

  const breadcrumbCrumbs = useMemo((): BreadcrumbCrumb[] => {
    const from = searchParams.get("from");
    const simId = searchParams.get("simulation_id");
    const simLabel = searchParams.get("simulation_label");

    if (from === "simulation" && simId) {
      return [
        { href: "/", label: "Tableau de bord" },
        { href: "/simulator", label: "Simulations" },
        { href: `/simulator/${simId}`, label: simLabel || "Simulation" },
        { label: product?.name || decodedSku },
      ];
    }

    const crumbs: BreadcrumbCrumb[] = [
      { href: "/", label: "Tableau de bord" },
      { href: "/catalog", label: "Catalogue" },
    ];
    if (product?.universe) {
      crumbs.push({ label: product.universe });
    }
    crumbs.push({ label: product?.name || decodedSku });
    return crumbs;
  }, [searchParams, product, decodedSku]);

  useBreadcrumbOverride(breadcrumbCrumbs, Boolean(decodedSku));

  const attrMap = useMemo(() => {
    const m: Record<string, unknown> = {};
    for (const v of attrsData ?? []) m[v.attribute] = v.value;
    return m;
  }, [attrsData]);

  const registryByCat = useMemo(() => {
    const map: Record<string, AttributeRegistry[]> = {};
    for (const a of registry ?? []) (map[a.category] ??= []).push(a);
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => a.display_order - b.display_order || a.code.localeCompare(b.code));
    }
    return map;
  }, [registry]);

  // ── Edit accessors ─────────────────────────────────────────────────────
  const clearError = useCallback(() => setSaveError(null), []);

  const setCore = useCallback(
    (field: keyof ProductDetail, value: unknown, valid: boolean) => {
      setFieldValidity((v) => ({ ...v, [`core:${String(field)}`]: valid }));
      setCoreDraft((d) => ({ ...d, [field]: value }));
      clearError();
    },
    [clearError],
  );

  const setAttr = useCallback(
    (attrId: string, value: unknown, valid: boolean) => {
      setFieldValidity((v) => ({ ...v, [`attr:${attrId}`]: valid }));
      setAttrDraft((d) => ({ ...d, [attrId]: value }));
      clearError();
    },
    [clearError],
  );

  const coreValue = useCallback(
    (field: keyof ProductDetail) =>
      String(field) in coreDraft ? coreDraft[String(field)] : product?.[field],
    [coreDraft, product],
  );

  const descValue = useCallback(
    (which: DescriptionKind, lang: string) => {
      const key = DESC_FIELD[which];
      const obj = (String(key) in coreDraft ? coreDraft[String(key)] : product?.[key]) as
        | Record<string, string>
        | undefined;
      return obj?.[lang] ?? "";
    },
    [coreDraft, product],
  );

  const setDesc = useCallback(
    (which: DescriptionKind, lang: string, value: string) => {
      const key = DESC_FIELD[which];
      const base = (String(key) in coreDraft ? coreDraft[String(key)] : product?.[key]) as
        | Record<string, string>
        | undefined;
      const next = { ...(base ?? {}), [lang]: value };
      // Backend requires a French marketing description (CDC §4.3).
      const valid = which !== "marketing" || !!(next.fr && next.fr.trim());
      setCore(key, next, valid);
    },
    [coreDraft, product, setCore],
  );

  const attrsByCategory = useCallback(
    (cat: AttributeCategory) => registryByCat[cat] ?? [],
    [registryByCat],
  );

  const attrValue = useCallback(
    (attrId: string) => (attrId in attrDraft ? attrDraft[attrId] : attrMap[attrId]),
    [attrDraft, attrMap],
  );

  // ── Autosave (CDC §4.3 — debounce 2s, optimistic + rollback) ─────────────
  const draft = useMemo(() => ({ core: coreDraft, attrs: attrDraft }), [coreDraft, attrDraft]);

  const persist = useCallback(async () => {
    if (!product) return;

    const corePatch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(coreDraft)) {
      if (fieldValidity[`core:${k}`] === false) continue;
      const serverVal = product[k as keyof ProductDetail];
      if (!eq(v, serverVal)) corePatch[k] = v;
    }

    const attrUpserts: [string, unknown][] = [];
    for (const [id, v] of Object.entries(attrDraft)) {
      if (fieldValidity[`attr:${id}`] === false) continue;
      if (!eq(v, attrMap[id])) attrUpserts.push([id, v]);
    }

    if (Object.keys(corePatch).length === 0 && attrUpserts.length === 0) return;

    try {
      if (Object.keys(corePatch).length > 0) {
        const updated = await updateProduct(product.id, corePatch);
        await mutate(productKey, updated, { revalidate: false });
      }
      if (attrUpserts.length > 0) {
        const results = await Promise.all(
          attrUpserts.map(([id, v]) => setProductAttribute(product.id, id, v)),
        );
        await mutate(
          attrsKey,
          (cur?: ProductAttributeValue[]) => mergeAttrValues(cur ?? [], results),
          { revalidate: false },
        );
      }
    } catch (e) {
      // Rollback: discard pending edits and refetch server truth (CDC §4.3).
      setSaveError(e instanceof Error ? e.message : "Erreur de sauvegarde");
      setCoreDraft({});
      setAttrDraft({});
      setFieldValidity({});
      void mutate(productKey);
      void mutate(attrsKey);
      throw e;
    }
  }, [product, coreDraft, attrDraft, attrMap, fieldValidity, mutate, productKey, attrsKey]);

  const { status, error: autosaveError } = useAutosave(draft, persist, {
    enabled: !!product,
  });

  const handleRecalc = async () => {
    if (!decodedSku) return;
    setRecalcing(true);
    try {
      const updated = await refreshPamp(decodedSku);
      await mutate(productKey, updated, { revalidate: false });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec du recalcul du PAMP");
    } finally {
      setRecalcing(false);
    }
  };

  const handleDelete = async () => {
    if (!product || !decodedSku) return;
    const label = product.sku_code || decodedSku;
    const ok = await confirm({
      title: "Supprimer le produit",
      description: `Supprimer le produit « ${label} » ? Le produit sera désactivé (soft delete) : il reste en base pour l'historique des simulations, mais n'est plus actif.`,
      confirmLabel: "Supprimer",
      destructive: true,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await deleteProduct(decodedSku);
      router.push("/catalog");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec de la suppression");
    } finally {
      setDeleting(false);
    }
  };

  const handleTranslate = useCallback(
    async (lang: "en" | "es") => {
      if (!decodedSku) return;
      setTranslating(lang);
      try {
        const updated = await translateProduct(decodedSku, lang);
        await mutate(productKey, updated, { revalidate: false });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Échec de la traduction");
      } finally {
        setTranslating(null);
      }
    },
    [decodedSku, mutate, productKey],
  );

  const editContext: EditContextValue | null = useMemo(() => {
    if (!product) return null;
    return {
      mode: editing ? "edit" : "read",
      lang: "fr",
      product,
      coreValue,
      setCore,
      descValue,
      setDesc,
      attrsByCategory,
      attrValue,
      setAttr,
    };
  }, [
    product,
    editing,
    coreValue,
    setCore,
    descValue,
    setDesc,
    attrsByCategory,
    attrValue,
    setAttr,
  ]);

  const odooUrl = buildOdooUrl(product?.odoo_id);

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-muted-foreground">
        <WarningCircle size={40} weight="duotone" className="text-destructive/60" />
        <p className="font-medium text-foreground">Produit introuvable</p>
        <p className="text-sm">{error?.message}</p>
        <div className="mt-2 flex items-center gap-3">
          <Button onClick={() => mutate(productKey)}>
            <ArrowsClockwise size={14} />
            Réessayer
          </Button>
          <Link href="/catalog" className="text-sm font-medium text-warm hover:text-accent-foreground">
            Retour au catalogue
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background p-6">
      {isLoading || !product ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(280px,1fr)_2fr]">
          <SkeletonBlock className="h-96" />
          <div className="flex flex-col gap-4">
            <SkeletonBlock className="h-10 w-full" />
            <SkeletonBlock className="h-64 w-full" />
          </div>
        </div>
      ) : (
        <EditContext.Provider value={editContext!}>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(280px,1fr)_2fr]">
            {/* Left — sticky identity card */}
            <aside>
              <KeyInfoCard product={product} latestPv={latestPv} />
            </aside>

            {/* Right — actions + tabs */}
            <div className="flex min-w-0 flex-col gap-4">
              {/* Action bar */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  {(editing || status === "saving" || saveError || autosaveError) && (
                    <SaveIndicator status={status} error={saveError ?? autosaveError} />
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRecalc}
                    disabled={recalcing}
                    title="Recharger le PAMP et le stock depuis Odoo"
                  >
                    <ArrowsClockwise size={14} className={cn(recalcing && "animate-spin")} />
                    {recalcing ? "Recalcul…" : "Recalculer PAMP"}
                  </Button>
                  {userCanEdit && (
                    <>
                      <Button
                        size="sm"
                        variant={editing ? "default" : "outline"}
                        onClick={() => setManualEditing(editing ? false : true)}
                      >
                        {editing ? <Check size={14} weight="bold" /> : <PencilSimple size={14} />}
                        {editing ? "Terminer" : "Modifier"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleDelete}
                        disabled={deleting || !product.is_active}
                        className="border-destructive/30 text-destructive hover:bg-destructive/10"
                        title={
                          product.is_active ? "Désactiver ce produit" : "Produit déjà désactivé"
                        }
                      >
                        <Trash size={14} />
                        {deleting ? "Suppression…" : "Supprimer"}
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {/* Tabs */}
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="h-auto w-full flex-wrap justify-start overflow-x-auto">
                  {TABS.map((tab) => (
                    <TabsTrigger key={tab.id} value={tab.id} className="flex-shrink-0 px-4 py-2">
                      {tab.label}
                    </TabsTrigger>
                  ))}
                </TabsList>

                <div className="mt-4">
                  <TabsContent value="general">
                    <GeneralTab onTranslate={handleTranslate} translating={translating} />
                  </TabsContent>
                  <TabsContent value="technical">
                    <TechnicalTab onTranslate={handleTranslate} translating={translating} />
                  </TabsContent>
                  <TabsContent value="marketing">
                    <MarketingTab />
                  </TabsContent>
                  <TabsContent value="logistics">
                    <LogisticsTab />
                  </TabsContent>
                  <TabsContent value="commercial">
                    <CommercialTab />
                  </TabsContent>
                  <TabsContent value="media">
                    <MediaTab />
                  </TabsContent>
                </div>
              </Tabs>

              {/* Footer actions (CDC §4.3) */}
              <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border pt-2">
                {odooUrl ? (
                  <Button variant="outline" size="sm" nativeButton={false} render={<a href={odooUrl} target="_blank" rel="noopener noreferrer" />}>
                    <ArrowSquareOut size={14} />
                    Voir dans Odoo
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled
                    title={
                      ODOO_BASE_URL
                        ? "Ce produit n'a pas d'identifiant Odoo."
                        : "URL Odoo non configurée (NEXT_PUBLIC_ODOO_BASE_URL)."
                    }
                  >
                    <ArrowSquareOut size={14} />
                    Voir dans Odoo
                  </Button>
                )}

                <AddToSimulationDialog productIds={[product.id]} productLabel={product.sku_code}>
                  <Button size="sm">
                    <Plus size={14} weight="bold" />
                    Ajouter à une simulation
                  </Button>
                </AddToSimulationDialog>

                <Button
                  variant="outline"
                  size="sm"
                  disabled
                  title="Disponible en MVP2"
                >
                  <ClockCounterClockwise size={14} />
                  Historique des modifications
                  <StatusBadge variant="warning" className="ml-1 px-1.5 py-0 text-[10px]">
                    MVP2
                  </StatusBadge>
                </Button>
              </div>
            </div>
          </div>
        </EditContext.Provider>
      )}
    </div>
  );
}
