"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import * as Tabs from "@radix-ui/react-tabs";
import {
  AlertCircle,
  Check,
  ChevronRight,
  ExternalLink,
  History,
  Loader2,
  Package,
  Pencil,
  Plus,
  RefreshCw,
} from "lucide-react";
import {
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
import { useAuth } from "@/contexts/AuthContext";
import { canEdit } from "@/lib/auth";
import { useAutosave } from "@/hooks/useAutosave";
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
    <div className="flex justify-between gap-3 py-2 border-b border-[#E2E8F0] last:border-0">
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
    <div className="bg-white border border-[#E2E8F0] rounded-xl p-5 shadow-sm lg:sticky lg:top-6">
      <div className="aspect-square w-full rounded-lg bg-slate-100 flex items-center justify-center mb-4">
        <Package size={48} className="text-slate-300" />
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-1">
        <h1 className="text-lg font-bold text-slate-900 font-mono">{product.sku_code}</h1>
        <span
          className={cn(
            "inline-flex px-2 py-0.5 rounded text-xs font-semibold",
            product.is_active ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500",
          )}
        >
          {product.is_active ? "Actif" : "Inactif"}
        </span>
      </div>
      <p className="text-sm text-slate-600 mb-4">{product.name}</p>

      <InfoLine label="Hiérarchie" value={hierarchy || <span className="text-slate-300">—</span>} />
      <InfoLine label="Marque" value={product.brand || <span className="text-slate-300">—</span>} />
      <InfoLine label="Stock" value={`${Math.round(stock)} u`} />
      <InfoLine
        label="PAMP"
        value={
          pamp > 0
            ? `${pamp.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
            : "—"
        }
      />
      <InfoLine
        label="Prix de vente actuel"
        value={
          latestPv > 0
            ? `${latestPv.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
            : "—"
        }
      />
    </div>
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
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-red-600" title={error}>
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
  const params = useParams<{ sku: string }>();
  const decodedSku = decodeURIComponent(params?.sku ?? "");
  const { role } = useAuth();
  const userCanEdit = canEdit(role);

  const productKey = useMemo(() => (decodedSku ? ["product", decodedSku] : null), [decodedSku]);
  const attrsKey = useMemo(() => (decodedSku ? ["product-attrs", decodedSku] : null), [decodedSku]);
  const { mutate } = useSWRConfig();

  const { data: product, isLoading, error } = useSWR<ProductDetail>(productKey, () => getProduct(decodedSku));
  const { data: attrsData } = useSWR<ProductAttributeValue[]>(attrsKey, () => getProductAttributes(decodedSku));
  const { data: registry } = useSWR<AttributeRegistry[]>("attr-registry", () => getAttributeRegistry());
  const { data: history6m } = useSWR(decodedSku ? ["price-history", decodedSku, "6m"] : null, () =>
    getPriceHistory(decodedSku, "6m"),
  );
  const latestPv = history6m?.points?.length ? parseDec(history6m.points[0].pv_eur) : 0;

  const [editing, setEditing] = useState(false);
  const [coreDraft, setCoreDraft] = useState<Record<string, unknown>>({});
  const [attrDraft, setAttrDraft] = useState<Record<string, unknown>>({});
  const [fieldValidity, setFieldValidity] = useState<Record<string, boolean>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [recalcing, setRecalcing] = useState(false);
  const [translating, setTranslating] = useState<"en" | "es" | null>(null);

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

  const { status, error: autosaveError } = useAutosave(draft, persist, { enabled: !!product });

  const handleRecalc = async () => {
    if (!decodedSku) return;
    setRecalcing(true);
    try {
      const updated = await refreshPamp(decodedSku);
      await mutate(productKey, updated, { revalidate: false });
    } catch (e) {
      alert(e instanceof Error ? e.message : "Échec du recalcul du PAMP");
    } finally {
      setRecalcing(false);
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
        alert(e instanceof Error ? e.message : "Échec de la traduction");
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
  }, [product, editing, coreValue, setCore, descValue, setDesc, attrsByCategory, attrValue, setAttr]);

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
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-[#E07200] rounded-lg hover:bg-[#C56400] transition-colors"
          >
            <RefreshCw size={14} />
            Réessayer
          </button>
          <Link href="/catalog" className="text-sm text-[#E07200] hover:text-[#C56400] font-medium">
            Retour au catalogue
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-slate-500 mb-4">
        <Link href="/catalog" className="hover:text-slate-700 transition-colors">
          Catalogue
        </Link>
        {product?.universe && (
          <>
            <ChevronRight size={14} className="text-slate-400" />
            <span className="text-slate-500">{product.universe}</span>
          </>
        )}
        <ChevronRight size={14} className="text-slate-400" />
        <span className="text-slate-800 font-medium">{decodedSku}</span>
      </nav>

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
                    className="flex items-center gap-2 px-3 py-2 text-sm border border-[#E2E8F0] rounded-lg hover:bg-slate-50 transition-colors text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Recharger le PAMP et le stock depuis Odoo"
                  >
                    <RefreshCw size={14} className={cn(recalcing && "animate-spin")} />
                    {recalcing ? "Recalcul…" : "Recalculer PAMP"}
                  </button>
                  {userCanEdit && (
                    <button
                      onClick={() => setEditing((e) => !e)}
                      className={cn(
                        "flex items-center gap-2 px-3 py-2 text-sm rounded-lg font-medium transition-colors",
                        editing
                          ? "bg-[#E07200] text-white hover:bg-[#C56400]"
                          : "border border-[#E2E8F0] text-slate-600 hover:bg-slate-50",
                      )}
                    >
                      {editing ? <Check size={14} /> : <Pencil size={14} />}
                      {editing ? "Terminer" : "Modifier"}
                    </button>
                  )}
                </div>
              </div>

              {/* Tabs */}
              <Tabs.Root defaultValue="general">
                <Tabs.List className="flex gap-0.5 bg-white border border-[#E2E8F0] rounded-xl p-1 shadow-sm overflow-x-auto">
                  {TABS.map((tab) => (
                    <Tabs.Trigger
                      key={tab.id}
                      value={tab.id}
                      className={cn(
                        "flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                        "text-slate-500 hover:text-slate-800",
                        "data-[state=active]:bg-[#E07200] data-[state=active]:text-white",
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
              <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-[#E2E8F0] mt-2">
                {odooUrl ? (
                  <a
                    href={odooUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-2 text-sm border border-[#E2E8F0] rounded-lg hover:bg-slate-50 transition-colors text-slate-600"
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
                    className="flex items-center gap-2 px-3 py-2 text-sm border border-[#E2E8F0] rounded-lg text-slate-300 cursor-not-allowed"
                  >
                    <ExternalLink size={14} />
                    Voir dans Odoo
                  </button>
                )}

                <AddToSimulationDialog productId={product.id} productLabel={product.sku_code}>
                  <button
                    type="button"
                    className="flex items-center gap-2 px-3 py-2 text-sm bg-[#E07200] hover:bg-[#C56400] text-white rounded-lg font-medium transition-colors"
                  >
                    <Plus size={14} />
                    Ajouter à une simulation
                  </button>
                </AddToSimulationDialog>

                <button
                  type="button"
                  disabled
                  title="Disponible en MVP2"
                  className="flex items-center gap-2 px-3 py-2 text-sm border border-[#E2E8F0] rounded-lg text-slate-300 cursor-not-allowed"
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
