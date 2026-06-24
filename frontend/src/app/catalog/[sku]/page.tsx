"use client";

import { useCallback, useMemo, useState, Suspense, type ReactNode } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import * as Tabs from "@radix-ui/react-tabs";
import {
  AlertCircle,
  Check,
  ExternalLink,
  History,
  Loader2,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
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
import { Card, CardContent } from "@/components/ui/card";
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
import { MediaTab } from "./_tabs/MediaTab";

const ODOO_BASE_URL = process.env.NEXT_PUBLIC_ODOO_BASE_URL ?? "";

const DESC_FIELD: Record<DescriptionKind, keyof ProductDetail> = {
  marketing: "description_marketing",
  technical: "description_technical",
};

function parseDec(v?: string | null): number {
  return v != null ? parseFloat(v) : 0;
}

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse bg-slate-200 rounded", className)} />;
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
    <div className="flex justify-between gap-3 py-2 border-b border-border last:border-0">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-sm font-medium text-slate-800 text-right">{value}</span>
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
      <div className="aspect-square w-full rounded-lg bg-muted flex items-center justify-center mb-4">
        <Package size={48} className="text-muted-foreground/40" />
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-1">
        <h1 className="text-lg font-bold text-foreground font-mono">{product.sku_code}</h1>
        <span
          className={cn(
            "inline-flex px-2 py-0.5 rounded text-xs font-semibold",
            product.is_active ? "bg-brand-green/10 text-brand-green" : "bg-muted text-muted-foreground",
          )}
        >
          {product.is_active ? "Actif" : "Inactif"}
        </span>
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
          accent="warm"
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
        className="inline-flex items-center gap-1.5 text-sm font-medium text-red-600"
        title={error}
      >
        <AlertCircle size={15} />
        Erreur de sauvegarde
      </span>
    );
  }
  if (status === "saving") {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-600">
        <Loader2 size={15} className="animate-spin" />
        Modifications en cours…
      </span>
    );
  }
  if (status === "saved") {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-green-600">
        <Check size={15} />
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
      <Skeleton className="h-8 w-48 mb-6" />
      <Skeleton className="h-64 w-full" />
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
  const latestPv = history6m?.points?.length ? parseDec(history6m.points[0].pv_eur) : 0;

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
        { href: "/catalog", label: "Accueil" },
        { href: "/simulator", label: "Simulations" },
        { href: `/simulator/${simId}`, label: simLabel || "Simulation" },
        { label: decodedSku },
      ];
    }

    const crumbs: BreadcrumbCrumb[] = [
      { href: "/catalog", label: "Accueil" },
      { href: "/catalog", label: "Catalogue" },
    ];
    if (product?.universe) {
      crumbs.push({ label: product.universe });
    }
    crumbs.push({ label: decodedSku });
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
      <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-500 p-10">
        <AlertCircle size={40} className="text-red-300" />
        <p className="font-medium">Produit introuvable</p>
        <p className="text-sm text-slate-400">{error?.message}</p>
        <div className="flex items-center gap-3 mt-2">
          <button
            onClick={() => mutate(productKey)}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors"
          >
            <RefreshCw size={14} />
            Réessayer
          </button>
          <Link href="/catalog" className="text-sm text-warm hover:text-accent-foreground font-medium">
            Retour au catalogue
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {isLoading || !product ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Skeleton className="h-96 lg:col-span-1" />
          <div className="lg:col-span-2 flex flex-col gap-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        </div>
      ) : (
        <EditContext.Provider value={editContext!}>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left — key info */}
            <aside className="lg:col-span-1">
              <KeyInfoCard product={product} latestPv={latestPv} />
            </aside>

            {/* Right — actions + tabs */}
            <div className="lg:col-span-2 flex flex-col gap-4 min-w-0">
              {/* Action bar */}
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                  {(editing || status === "saving" || saveError || autosaveError) && (
                    <SaveIndicator status={status} error={saveError ?? autosaveError} />
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={handleRecalc}
                    disabled={recalcing}
                    className="flex items-center gap-2 px-3 py-2 text-sm border border-border rounded-lg hover:bg-slate-50 transition-colors text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Recharger le PAMP et le stock depuis Odoo"
                  >
                    <RefreshCw size={14} className={cn(recalcing && "animate-spin")} />
                    {recalcing ? "Recalcul…" : "Recalculer PAMP"}
                  </button>
                  {userCanEdit && (
                    <>
                      <button
                        onClick={() => setManualEditing(editing ? false : true)}
                        className={cn(
                          "flex items-center gap-2 px-3 py-2 text-sm rounded-lg font-medium transition-colors",
                          editing
                            ? "bg-primary text-white hover:bg-primary/90"
                            : "border border-border text-slate-600 hover:bg-slate-50",
                        )}
                      >
                        {editing ? <Check size={14} /> : <Pencil size={14} />}
                        {editing ? "Terminer" : "Modifier"}
                      </button>
                      <button
                        type="button"
                        onClick={handleDelete}
                        disabled={deleting || !product.is_active}
                        className="flex items-center gap-2 px-3 py-2 text-sm border border-red-200 rounded-lg text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        title={
                          product.is_active ? "Désactiver ce produit" : "Produit déjà désactivé"
                        }
                      >
                        <Trash2 size={14} />
                        {deleting ? "Suppression…" : "Supprimer"}
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Tabs */}
              <Tabs.Root value={activeTab} onValueChange={setActiveTab}>
                <Tabs.List className="flex gap-0.5 bg-white border border-border rounded-xl p-1 shadow-sm overflow-x-auto">
                  {TABS.map((tab) => (
                    <Tabs.Trigger
                      key={tab.id}
                      value={tab.id}
                      className={cn(
                        "flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                        "text-slate-500 hover:text-slate-800",
                        "data-[state=active]:bg-primary data-[state=active]:text-white",
                      )}
                    >
                      {tab.label}
                    </Tabs.Trigger>
                  ))}
                </Tabs.List>

                <div className="mt-4">
                  <Tabs.Content value="general">
                    <GeneralTab onTranslate={handleTranslate} translating={translating} />
                  </Tabs.Content>
                  <Tabs.Content value="technical">
                    <TechnicalTab onTranslate={handleTranslate} translating={translating} />
                  </Tabs.Content>
                  <Tabs.Content value="marketing">
                    <MarketingTab />
                  </Tabs.Content>
                  <Tabs.Content value="logistics">
                    <LogisticsTab />
                  </Tabs.Content>
                  <Tabs.Content value="commercial">
                    <CommercialTab />
                  </Tabs.Content>
                  <Tabs.Content value="media">
                    <MediaTab />
                  </Tabs.Content>
                </div>
              </Tabs.Root>

              {/* Footer actions (CDC §4.3) */}
              <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-border mt-2">
                {odooUrl ? (
                  <a
                    href={odooUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-2 text-sm border border-border rounded-lg hover:bg-slate-50 transition-colors text-slate-600"
                  >
                    <ExternalLink size={14} />
                    Voir dans Odoo
                  </a>
                ) : (
                  <button
                    type="button"
                    disabled
                    title={
                      ODOO_BASE_URL
                        ? "Ce produit n'a pas d'identifiant Odoo."
                        : "URL Odoo non configurée (NEXT_PUBLIC_ODOO_BASE_URL)."
                    }
                    className="flex items-center gap-2 px-3 py-2 text-sm border border-border rounded-lg text-slate-300 cursor-not-allowed"
                  >
                    <ExternalLink size={14} />
                    Voir dans Odoo
                  </button>
                )}

                <AddToSimulationDialog productIds={[product.id]} productLabel={product.sku_code}>
                  <button
                    type="button"
                    className="flex items-center gap-2 px-3 py-2 text-sm bg-primary hover:bg-primary/90 text-white rounded-lg font-medium transition-colors"
                  >
                    <Plus size={14} />
                    Ajouter à une simulation
                  </button>
                </AddToSimulationDialog>

                <button
                  type="button"
                  disabled
                  title="Disponible en MVP2"
                  className="flex items-center gap-2 px-3 py-2 text-sm border border-border rounded-lg text-slate-300 cursor-not-allowed"
                >
                  <History size={14} />
                  Historique des modifications
                  <span className="ml-1 inline-flex px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px] font-semibold">
                    MVP2
                  </span>
                </button>
              </div>
            </div>
          </div>
        </EditContext.Provider>
      )}
    </div>
  );
}
