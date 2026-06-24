"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import {
  ArrowLeft,
  ArrowRight,
  CaretRight,
  Check,
  CircleNotch,
  Package,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  createProduct,
  createSupplier,
  getAttributeRegistry,
  getHierarchyLevel,
  parseSku,
  setProductAttribute,
  type AttributeRegistry,
  type ProductDetail,
  type ProductSupplier,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { canEdit } from "@/lib/auth";
import { AttributeRenderer, validateAttributeValue } from "@/components/AttributeRenderer";
import { FormField } from "@/components/FormField";
import { SupplierManager } from "@/components/SupplierManager";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

const DRAFT_KEY = "syskern:new-product-draft:v1";
const SKU_RE = /^[A-Z0-9-]+$/;

type Core = Record<string, unknown>;

interface WizardDraft {
  core: Core;
  attrs: Record<string, unknown>;
  suppliers: ProductSupplier[];
  fullForm: boolean;
}

const STEPS = [
  { id: "identification", label: "Identification" },
  { id: "technical", label: "Technique" },
  { id: "logistics", label: "Logistique" },
  { id: "suppliers", label: "Fournisseur(s)" },
  { id: "review", label: "Validation" },
] as const;

const BASE_UNIT_OPTIONS = [
  { value: "unit", label: "Unité" },
  { value: "km", label: "Kilomètre" },
  { value: "m", label: "Mètre" },
];

const SUPPLY_POLICY_OPTIONS = [
  { value: "buy", label: "Achat & stock" },
  { value: "dropship", label: "Dropship" },
  { value: "mixed", label: "Mixte" },
];

function emptyDraft(): WizardDraft {
  return {
    core: { base_unit: "unit", supply_policy: "buy", is_stockable: true, is_copper_indexed: false },
    attrs: {},
    suppliers: [],
    fullForm: false,
  };
}

function loadDraft(): WizardDraft {
  if (typeof window === "undefined") return emptyDraft();
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return emptyDraft();
    const parsed = JSON.parse(raw) as Partial<WizardDraft> & { step?: number };
    // `step` was persisted in v1 drafts — intentionally not restored (always start at Identification).
    return {
      ...emptyDraft(),
      core: parsed.core ?? emptyDraft().core,
      attrs: parsed.attrs ?? {},
      suppliers: parsed.suppliers ?? [],
      fullForm: parsed.fullForm ?? false,
    };
  } catch {
    return emptyDraft();
  }
}

function TextField({
  label,
  value,
  onChange,
  required,
  invalid,
  onBlur,
  placeholder,
  mono,
  error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  invalid?: boolean;
  onBlur?: () => void;
  placeholder?: string;
  mono?: boolean;
  error?: string;
}) {
  return (
    <FormField label={label} required={required} error={invalid ? error : undefined}>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        className={cn(mono && "font-mono", invalid && "border-destructive")}
      />
    </FormField>
  );
}

function AreaField({
  label,
  value,
  onChange,
  required,
  invalid,
  error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  invalid?: boolean;
  error?: string;
}) {
  return (
    <FormField label={label} required={required} error={invalid ? error : undefined}>
      <Textarea
        value={value}
        rows={3}
        onChange={(e) => onChange(e.target.value)}
        className={cn("resize-y", invalid && "border-destructive")}
      />
    </FormField>
  );
}

function NumberField({
  label,
  value,
  onChange,
  unit,
  integer,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  unit?: string;
  integer?: boolean;
}) {
  return (
    <FormField label={label}>
      <div className="relative">
        <Input
          type="number"
          inputMode={integer ? "numeric" : "decimal"}
          step={integer ? 1 : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(unit && "pr-12")}
        />
        {unit && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
            {unit}
          </span>
        )}
      </div>
    </FormField>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
  disabled,
  placeholder,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <FormField label={label}>
      <Select
        value={value || undefined}
        onValueChange={(v) => onChange(v ?? "")}
        disabled={disabled}
      >
        <SelectTrigger className="w-full bg-background">
          <SelectValue placeholder={placeholder ?? "Sélectionner…"} />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  );
}

function ToggleField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-sm font-semibold text-foreground">{label}</span>
      <Switch checked={value} onCheckedChange={onChange} />
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="border-none pb-0">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-3">{children}</CardContent>
    </Card>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function NewProductPage() {
  const router = useRouter();
  const { role, isLoading: authLoading } = useAuth();
  const userCanEdit = canEdit(role);

  const [initial] = useState(loadDraft);
  const [core, setCoreState] = useState<Core>(initial.core);
  const [attrs, setAttrs] = useState<Record<string, unknown>>(initial.attrs);
  const [attrValidity, setAttrValidity] = useState<Record<string, boolean>>({});
  const [suppliers, setSuppliers] = useState<ProductSupplier[]>(initial.suppliers);
  const [step, setStep] = useState(0);
  const [fullForm, setFullForm] = useState<boolean>(initial.fullForm);
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Track whether the user manually edited the auto-derived fields.
  const touchedRef = useRef<{ parent: boolean; factory: boolean }>({ parent: false, factory: false });

  const { data: technicalAttrs } = useSWR<AttributeRegistry[]>("attr-registry-technical", () =>
    getAttributeRegistry("technical"),
  );

  // Persist field values only — not the wizard step (reopen always on Identification).
  useEffect(() => {
    const draft: WizardDraft = { core, attrs, suppliers, fullForm };
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* storage unavailable — ignore */
    }
  }, [core, attrs, suppliers, fullForm]);

  const set = useCallback((key: string, value: unknown) => {
    setCoreState((c) => ({ ...c, [key]: value }));
  }, []);

  const str = useCallback((key: string) => (core[key] == null ? "" : String(core[key])), [core]);

  const universe = str("universe");
  const family = str("family");
  const rangeVal = str("range");

  const { data: universeOptions } = useSWR("hierarchy-universe", () =>
    getHierarchyLevel("universe"),
  );
  const { data: familyOptions } = useSWR(
    universe ? ["hierarchy-family", universe] : null,
    () => getHierarchyLevel("family", { universe }),
  );
  const { data: rangeOptions } = useSWR(
    universe && family ? ["hierarchy-range", universe, family] : null,
    () => getHierarchyLevel("range", { universe, family }),
  );
  const { data: subRangeOptions } = useSWR(
    universe && family && rangeVal ? ["hierarchy-sub_range", universe, family, rangeVal] : null,
    () => getHierarchyLevel("sub_range", { universe, family, range: rangeVal }),
  );

  const toHierarchyOptions = (vals?: string[]) =>
    (vals ?? []).map((v) => ({ value: v, label: v }));

  const desc = useCallback(
    (lang: string) => {
      const m = core.description_marketing as Record<string, string> | undefined;
      return m?.[lang] ?? "";
    },
    [core],
  );
  const setDesc = useCallback(
    (lang: string, value: string) => {
      setCoreState((c) => {
        const m = { ...((c.description_marketing as Record<string, string>) ?? {}) };
        m[lang] = value;
        return { ...c, description_marketing: m };
      });
    },
    [],
  );

  // ── Validation ───────────────────────────────────────────────────────────
  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    const sku = str("sku_code").trim();
    if (!sku) e.sku_code = "Le SKU est requis.";
    else if (!SKU_RE.test(sku)) e.sku_code = "Majuscules, chiffres et tirets uniquement.";
    if (!str("name").trim()) e.name = "Le nom est requis.";
    if (!desc("fr").trim()) e.description_fr = "La description marketing FR est requise.";
    if (core.is_copper_indexed === true) {
      const w = Number(core.copper_weight_kg_per_unit);
      if (!core.copper_weight_kg_per_unit || !Number.isFinite(w) || w <= 0)
        e.copper_weight_kg_per_unit = "Poids cuivre requis et > 0 si indexé cuivre.";
    }
    for (const a of technicalAttrs ?? []) {
      if (attrValidity[a.id] === false) e[`attr:${a.id}`] = "Valeur invalide.";
    }
    return e;
  }, [str, desc, core, technicalAttrs, attrValidity]);

  const stepHasError = useCallback(
    (idx: number) => {
      switch (STEPS[idx].id) {
        case "identification":
          return !!(errors.sku_code || errors.name || errors.description_fr);
        case "technical":
          return Object.keys(errors).some((k) => k.startsWith("attr:"));
        case "logistics":
          return !!errors.copper_weight_kg_per_unit;
        default:
          return false;
      }
    },
    [errors],
  );

  const canSubmit = Object.keys(errors).length === 0;

  const goNext = () => {
    if (stepHasError(step)) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };
  const goPrev = () => {
    setShowErrors(false);
    setStep((s) => Math.max(s - 1, 0));
  };

  // ── SKU parsing (auto-fill parent_reference + factory_code) ────────────────
  const handleSkuBlur = useCallback(async () => {
    const sku = str("sku_code").trim();
    if (!sku) return;
    try {
      const parsed = await parseSku(sku);
      setCoreState((c) => {
        const next = { ...c };
        if (!touchedRef.current.parent && parsed.parent_reference != null)
          next.parent_reference = parsed.parent_reference;
        if (!touchedRef.current.factory && parsed.factory_code != null)
          next.factory_code = parsed.factory_code;
        return next;
      });
    } catch {
      /* parsing is best-effort; the user can fill the fields manually */
    }
  }, [str]);

  // ── Draft supplier handlers (local; persisted after product creation) ──────
  const supplierCreate = useCallback((data: Parameters<typeof createSupplier>[1]) => {
    setSuppliers((list) => {
      const makeActive = data.is_active || list.length === 0;
      const row: ProductSupplier = {
        id: crypto.randomUUID(),
        supplier_name: data.supplier_name,
        factory_code: data.factory_code,
        po_base_price: data.po_base_price ?? null,
        po_currency: data.po_currency,
        is_copper_indexed: data.is_copper_indexed,
        copper_base_price: data.copper_base_price ?? null,
        incoterm: data.incoterm,
        incoterm_location: data.incoterm_location,
        notes: data.notes,
        is_active: makeActive,
      };
      const cleared = makeActive ? list.map((s) => ({ ...s, is_active: false })) : list;
      return [...cleared, row];
    });
  }, []);
  const supplierUpdate = useCallback(
    (id: string, data: Parameters<typeof createSupplier>[1]) => {
      setSuppliers((list) => list.map((s) => (s.id === id ? { ...s, ...data } : s)));
    },
    [],
  );
  const supplierDelete = useCallback((id: string) => {
    setSuppliers((list) => list.filter((s) => s.id !== id));
  }, []);
  const supplierActivate = useCallback((id: string) => {
    setSuppliers((list) => list.map((s) => ({ ...s, is_active: s.id === id })));
  }, []);

  // ── Create flow ────────────────────────────────────────────────────────────
  const buildPayload = useCallback((): Partial<ProductDetail> => {
    const payload: Record<string, unknown> = {};
    const passthrough = [
      "sku_code",
      "name",
      "parent_reference",
      "factory_code",
      "item_code",
      "brand",
      "universe",
      "family",
      "range",
      "sub_range",
      "gtin",
      "hs_code",
      "dop_number",
      "base_unit",
      "supply_policy",
    ];
    for (const k of passthrough) {
      const v = str(k).trim();
      if (v) payload[k] = v;
    }
    payload.description_marketing = (core.description_marketing as Record<string, string>) ?? {};
    payload.is_stockable = core.is_stockable === true;
    payload.is_copper_indexed = core.is_copper_indexed === true;

    const decimals = ["unit_weight_kg", "copper_weight_kg_per_unit"];
    for (const k of decimals) {
      const v = str(k).trim();
      if (v) payload[k] = v;
    }
    const ints = [
      "primary_packaging_qty",
      "secondary_packaging_qty",
      "tertiary_packaging_qty",
      "pallet_qty",
    ];
    for (const k of ints) {
      const v = str(k).trim();
      if (v && Number.isInteger(Number(v))) payload[k] = Number(v);
    }
    return payload as Partial<ProductDetail>;
  }, [core, str]);

  const handleSubmit = async () => {
    if (!canSubmit) {
      setShowErrors(true);
      setStep(stepHasError(0) ? 0 : stepHasError(1) ? 1 : 2);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const product = await createProduct(buildPayload());

      for (const a of technicalAttrs ?? []) {
        const value = attrs[a.id];
        const empty =
          value == null || value === "" || (Array.isArray(value) && value.length === 0);
        if (!empty) await setProductAttribute(product.id, a.id, value);
      }

      for (const s of suppliers) {
        await createSupplier(product.id, {
          supplier_name: s.supplier_name,
          factory_code: s.factory_code,
          po_base_price: s.po_base_price ?? null,
          po_currency: s.po_currency,
          is_copper_indexed: s.is_copper_indexed,
          copper_base_price: s.copper_base_price ?? null,
          incoterm: s.incoterm,
          incoterm_location: s.incoterm_location,
          notes: s.notes,
          is_active: s.is_active,
        });
      }

      try {
        window.localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* ignore */
      }
      router.push(`/catalog/${encodeURIComponent(product.sku_code)}`);
    } catch (e) {
      // Local creation failing here means the product itself was rejected
      // (validation). Odoo sync is server-side and never blocks creation.
      setSubmitError(e instanceof Error ? e.message : "Échec de la création du produit.");
      setSubmitting(false);
    }
  };

  // ── Step renderers ─────────────────────────────────────────────────────────
  const renderIdentification = () => (
    <div className="flex flex-col gap-6">
      <SectionCard title="Identification">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <TextField
            label="SKU"
            value={str("sku_code")}
            onChange={(v) => set("sku_code", v.toUpperCase())}
            onBlur={handleSkuBlur}
            required
            mono
            invalid={showErrors && !!errors.sku_code}
            error={errors.sku_code}
            placeholder="ex. KCFF6A4PZHDBL5-21"
          />
          <TextField
            label="Nom"
            value={str("name")}
            onChange={(v) => set("name", v)}
            required
            invalid={showErrors && !!errors.name}
            error={errors.name}
          />
          <TextField
            label="Référence parent (auto)"
            value={str("parent_reference")}
            onChange={(v) => {
              touchedRef.current.parent = true;
              set("parent_reference", v);
            }}
          />
          <TextField
            label="Code usine (auto)"
            value={str("factory_code")}
            onChange={(v) => {
              touchedRef.current.factory = true;
              set("factory_code", v);
            }}
          />
          <TextField label="Marque" value={str("brand")} onChange={(v) => set("brand", v)} />
          <TextField label="Code article" value={str("item_code")} onChange={(v) => set("item_code", v)} />
        </div>
      </SectionCard>

      <SectionCard title="Hiérarchie">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <SelectField
            label="Univers"
            value={str("universe")}
            options={toHierarchyOptions(universeOptions)}
            onChange={(v) =>
              setCoreState((c) => ({ ...c, universe: v, family: "", range: "", sub_range: "" }))
            }
          />
          <SelectField
            label="Famille"
            value={str("family")}
            options={toHierarchyOptions(familyOptions)}
            disabled={!universe}
            placeholder={universe ? "Sélectionner…" : "Choisir un univers d'abord"}
            onChange={(v) => setCoreState((c) => ({ ...c, family: v, range: "", sub_range: "" }))}
          />
          <SelectField
            label="Gamme"
            value={str("range")}
            options={toHierarchyOptions(rangeOptions)}
            disabled={!family}
            placeholder={family ? "Sélectionner…" : "Choisir une famille d'abord"}
            onChange={(v) => setCoreState((c) => ({ ...c, range: v, sub_range: "" }))}
          />
          <SelectField
            label="Sous-gamme"
            value={str("sub_range")}
            options={toHierarchyOptions(subRangeOptions)}
            disabled={!rangeVal}
            placeholder={rangeVal ? "Sélectionner…" : "Choisir une gamme d'abord"}
            onChange={(v) => set("sub_range", v)}
          />
        </div>
      </SectionCard>

      <SectionCard title="Descriptions multilingues">
        <div className="flex flex-col gap-4">
          <AreaField
            label="Description marketing (FR)"
            value={desc("fr")}
            onChange={(v) => setDesc("fr", v)}
            required
            invalid={showErrors && !!errors.description_fr}
            error={errors.description_fr}
          />
          <AreaField label="Description marketing (EN)" value={desc("en")} onChange={(v) => setDesc("en", v)} />
          <AreaField label="Description marketing (ES)" value={desc("es")} onChange={(v) => setDesc("es", v)} />
        </div>
      </SectionCard>

      <SectionCard title="Identifiants">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <TextField label="GTIN" value={str("gtin")} onChange={(v) => set("gtin", v)} />
          <TextField label="Code HS" value={str("hs_code")} onChange={(v) => set("hs_code", v)} />
          <TextField label="N° DOP" value={str("dop_number")} onChange={(v) => set("dop_number", v)} />
        </div>
      </SectionCard>
    </div>
  );

  const renderTechnical = () => (
    <SectionCard title="Caractéristiques techniques">
      {(technicalAttrs ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun attribut technique défini dans le registre.</p>
      ) : (
        (technicalAttrs ?? [])
          .slice()
          .sort((a, b) => a.display_order - b.display_order || a.code.localeCompare(b.code))
          .map((a) => (
            <AttributeRenderer
              key={a.id}
              attribute={a}
              value={attrs[a.id]}
              mode="edit"
              onChange={(v) => {
                setAttrs((d) => ({ ...d, [a.id]: v }));
                setAttrValidity((d) => ({ ...d, [a.id]: validateAttributeValue(a, v) }));
              }}
            />
          ))
      )}
    </SectionCard>
  );

  const renderLogistics = () => (
    <div className="flex flex-col gap-6">
      <SectionCard title="Poids & unité">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <NumberField label="Poids unitaire" value={str("unit_weight_kg")} onChange={(v) => set("unit_weight_kg", v)} unit="kg" />
          <SelectField label="Unité de base" value={str("base_unit")} options={BASE_UNIT_OPTIONS} onChange={(v) => set("base_unit", v)} />
          <SelectField label="Approvisionnement" value={str("supply_policy")} options={SUPPLY_POLICY_OPTIONS} onChange={(v) => set("supply_policy", v)} />
          <ToggleField label="Stockable" value={core.is_stockable === true} onChange={(v) => set("is_stockable", v)} />
        </div>
      </SectionCard>

      <SectionCard title="Conditionnement">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <NumberField label="Qté colisage primaire" value={str("primary_packaging_qty")} onChange={(v) => set("primary_packaging_qty", v)} integer />
          <NumberField label="Qté colisage secondaire" value={str("secondary_packaging_qty")} onChange={(v) => set("secondary_packaging_qty", v)} integer />
          <NumberField label="Qté colisage tertiaire" value={str("tertiary_packaging_qty")} onChange={(v) => set("tertiary_packaging_qty", v)} integer />
          <NumberField label="Qté palette" value={str("pallet_qty")} onChange={(v) => set("pallet_qty", v)} integer />
        </div>
      </SectionCard>

      <SectionCard title="Indexation cuivre">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
          <ToggleField label="Indexé cuivre" value={core.is_copper_indexed === true} onChange={(v) => set("is_copper_indexed", v)} />
          {core.is_copper_indexed === true && (
            <div>
              <NumberField label="Poids cuivre / unité" value={str("copper_weight_kg_per_unit")} onChange={(v) => set("copper_weight_kg_per_unit", v)} unit="kg" />
              {showErrors && errors.copper_weight_kg_per_unit && (
                <p className="text-xs text-red-500 mt-1">{errors.copper_weight_kg_per_unit}</p>
              )}
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  );

  const renderSuppliers = () => (
    <SectionCard title="Fournisseur(s)">
      <p className="mb-4 text-sm text-muted-foreground">
        Ajoutez le premier fournisseur du produit. La source active fournit les paramètres de calcul
        lors des simulations.
      </p>
      <SupplierManager
        suppliers={suppliers}
        onCreate={supplierCreate}
        onUpdate={supplierUpdate}
        onDelete={supplierDelete}
        onActivate={supplierActivate}
      />
    </SectionCard>
  );

  const renderReview = () => {
    const activeSupplier = suppliers.find((s) => s.is_active) ?? suppliers[0];
    return (
      <SectionCard title="Récapitulatif">
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <Recap label="SKU" value={str("sku_code")} mono />
          <Recap label="Nom" value={str("name")} />
          <Recap label="Référence parent" value={str("parent_reference")} />
          <Recap label="Code usine" value={str("factory_code")} />
          <Recap label="Marque" value={str("brand")} />
          <Recap
            label="Hiérarchie"
            value={[str("universe"), str("family"), str("range"), str("sub_range")].filter(Boolean).join(" › ")}
          />
          <Recap label="Attributs techniques renseignés" value={String(Object.values(attrs).filter((v) => v != null && v !== "").length)} />
          <Recap label="Fournisseurs" value={String(suppliers.length)} />
          <Recap label="Fournisseur actif" value={activeSupplier?.supplier_name ?? "—"} />
        </dl>
        <p className="mt-4 text-xs text-muted-foreground">
          La synchronisation vers Odoo est déclenchée automatiquement après la création et n&apos;empêche
          pas la création locale en cas d&apos;indisponibilité.
        </p>
      </SectionCard>
    );
  };

  const renderStep = (idx: number) => {
    switch (STEPS[idx].id) {
      case "identification":
        return renderIdentification();
      case "technical":
        return renderTechnical();
      case "logistics":
        return renderLogistics();
      case "suppliers":
        return renderSuppliers();
      case "review":
        return renderReview();
      default:
        return null;
    }
  };

  // ── Guards ─────────────────────────────────────────────────────────────────
  if (!authLoading && !userCanEdit) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-muted-foreground">
        <WarningCircle size={40} weight="duotone" className="text-warm" />
        <p className="font-medium text-foreground">Accès restreint</p>
        <p className="text-sm">La création de produit est réservée aux rôles admin et commercial.</p>
        <Link href="/catalog" className="text-sm font-medium text-warm hover:text-accent-foreground">
          Retour au catalogue
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl bg-background p-6">
      {/* Breadcrumb */}
      <nav className="mb-4 flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link href="/catalog" className="transition-colors hover:text-foreground">
          Catalogue
        </Link>
        <CaretRight size={14} />
        <span className="font-medium text-foreground">Nouveau produit</span>
      </nav>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Package size={20} weight="duotone" className="text-warm" />
          <h1 className="text-xl font-semibold text-foreground">Créer un produit</h1>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <span>Formulaire complet</span>
          <Switch checked={fullForm} onCheckedChange={setFullForm} />
        </label>
      </div>

      {/* Progress indicator (wizard mode only) */}
      {!fullForm && (
        <ol className="mb-6 flex items-center gap-2 overflow-x-auto">
          {STEPS.map((s, idx) => {
            const active = idx === step;
            const done = idx < step;
            const err = showErrors && stepHasError(idx);
            return (
              <li key={s.id} className="flex flex-shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => setStep(idx)}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-primary text-primary-foreground"
                      : done
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-muted",
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
                      err && "bg-destructive text-destructive-foreground",
                    )}
                  >
                    {done ? <Check size={12} weight="bold" /> : idx + 1}
                  </span>
                  {s.label}
                </button>
                {idx < STEPS.length - 1 && <CaretRight size={14} className="text-muted-foreground/40" />}
              </li>
            );
          })}
        </ol>
      )}

      {/* Body */}
      {fullForm ? (
        <div className="flex flex-col gap-8">
          {STEPS.filter((s) => s.id !== "review").map((s, idx) => (
            <section key={s.id}>
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground">
                {idx + 1}. {s.label}
              </h2>
              {renderStep(STEPS.findIndex((x) => x.id === s.id))}
            </section>
          ))}
        </div>
      ) : (
        renderStep(step)
      )}

      {submitError && (
        <div className="mt-6 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <WarningCircle size={16} className="mt-0.5 flex-shrink-0" weight="duotone" />
          <span>{submitError}</span>
        </div>
      )}

      {/* Footer navigation */}
      <div className="mt-8 flex items-center justify-between gap-3 border-t border-border pt-4">
        {!fullForm && step > 0 ? (
          <Button type="button" variant="outline" onClick={goPrev}>
            <ArrowLeft size={15} />
            Précédent
          </Button>
        ) : (
          <Button nativeButton={false} variant="outline" render={<Link href="/catalog" />}>
            <ArrowLeft size={15} />
            Annuler
          </Button>
        )}

        {fullForm || step === STEPS.length - 1 ? (
          <Button type="button" onClick={handleSubmit} disabled={submitting}>
            {submitting && <CircleNotch size={15} className="animate-spin" />}
            {submitting ? "Création…" : "Créer et synchroniser vers Odoo"}
          </Button>
        ) : (
          <Button type="button" onClick={goNext}>
            Suivant
            <ArrowRight size={15} />
          </Button>
        )}
      </div>
    </div>
  );
}

function Recap({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border py-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("text-right font-medium text-foreground", mono && "font-mono")}>
        {value || <span className="text-muted-foreground/50">—</span>}
      </dd>
    </div>
  );
}
