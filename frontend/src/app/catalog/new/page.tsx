"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import * as Select from "@radix-ui/react-select";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  Package,
} from "lucide-react";
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
import { SupplierManager } from "@/components/SupplierManager";

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

const inputCls =
  "w-full px-3 py-2 text-sm border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#E07200]/30 focus:border-[#E07200]";

// ─── Small bound inputs ──────────────────────────────────────────────────────

function TextField({
  label,
  value,
  onChange,
  required,
  invalid,
  onBlur,
  placeholder,
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  invalid?: boolean;
  onBlur?: () => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-500">
        {label}
        {required && <span className="text-red-400 ml-0.5">*</span>}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        className={cn(inputCls, mono && "font-mono", invalid && "border-red-400 focus:ring-red-200")}
      />
    </label>
  );
}

function AreaField({
  label,
  value,
  onChange,
  required,
  invalid,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  invalid?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-500">
        {label}
        {required && <span className="text-red-400 ml-0.5">*</span>}
      </span>
      <textarea
        value={value}
        rows={3}
        onChange={(e) => onChange(e.target.value)}
        className={cn(inputCls, "resize-y", invalid && "border-red-400 focus:ring-red-200")}
      />
    </label>
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
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <div className="relative">
        <input
          type="number"
          inputMode={integer ? "numeric" : "decimal"}
          step={integer ? 1 : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(inputCls, unit && "pr-12")}
        />
        {unit && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400 pointer-events-none">
            {unit}
          </span>
        )}
      </div>
    </label>
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
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <Select.Root
        value={value || undefined}
        onValueChange={onChange}
        disabled={disabled}
      >
        <Select.Trigger
          className={cn(
            inputCls,
            "flex items-center justify-between gap-2 text-left disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          <Select.Value placeholder={placeholder ?? "Sélectionner…"} />
          <Select.Icon>
            <ChevronDown size={15} className="text-slate-400" />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content
            position="popper"
            sideOffset={4}
            className="z-50 min-w-[var(--radix-select-trigger-width)] bg-white border border-[#E2E8F0] rounded-lg shadow-lg overflow-hidden"
          >
            <Select.Viewport className="p-1">
              {options.map((opt) => (
                <Select.Item
                  key={opt.value}
                  value={opt.value}
                  className="flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-md cursor-pointer select-none outline-none data-[highlighted]:bg-[#FFF3E0] data-[highlighted]:text-[#C56400]"
                >
                  <Select.ItemText>{opt.label}</Select.ItemText>
                  <Select.ItemIndicator>
                    <Check size={14} className="text-[#E07200]" />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </label>
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
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={cn(
          "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
          value ? "bg-[#E07200]" : "bg-slate-300",
        )}
      >
        <span
          className={cn(
            "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
            value ? "translate-x-6" : "translate-x-1",
          )}
        />
      </button>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-xl p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-700 mb-3">{title}</h3>
      {children}
    </div>
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
      <Card title="Identification">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <TextField
            label="SKU"
            value={str("sku_code")}
            onChange={(v) => set("sku_code", v.toUpperCase())}
            onBlur={handleSkuBlur}
            required
            mono
            invalid={showErrors && !!errors.sku_code}
            placeholder="ex. KCFF6A4PZHDBL5-21"
          />
          <TextField
            label="Nom"
            value={str("name")}
            onChange={(v) => set("name", v)}
            required
            invalid={showErrors && !!errors.name}
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
      </Card>

      <Card title="Hiérarchie">
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
      </Card>

      <Card title="Descriptions multilingues">
        <div className="flex flex-col gap-4">
          <AreaField
            label="Description marketing (FR)"
            value={desc("fr")}
            onChange={(v) => setDesc("fr", v)}
            required
            invalid={showErrors && !!errors.description_fr}
          />
          <AreaField label="Description marketing (EN)" value={desc("en")} onChange={(v) => setDesc("en", v)} />
          <AreaField label="Description marketing (ES)" value={desc("es")} onChange={(v) => setDesc("es", v)} />
        </div>
      </Card>

      <Card title="Identifiants">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <TextField label="GTIN" value={str("gtin")} onChange={(v) => set("gtin", v)} />
          <TextField label="Code HS" value={str("hs_code")} onChange={(v) => set("hs_code", v)} />
          <TextField label="N° DOP" value={str("dop_number")} onChange={(v) => set("dop_number", v)} />
        </div>
      </Card>
    </div>
  );

  const renderTechnical = () => (
    <Card title="Caractéristiques techniques">
      {(technicalAttrs ?? []).length === 0 ? (
        <p className="text-sm text-slate-400">Aucun attribut technique défini dans le registre.</p>
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
    </Card>
  );

  const renderLogistics = () => (
    <div className="flex flex-col gap-6">
      <Card title="Poids & unité">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <NumberField label="Poids unitaire" value={str("unit_weight_kg")} onChange={(v) => set("unit_weight_kg", v)} unit="kg" />
          <SelectField label="Unité de base" value={str("base_unit")} options={BASE_UNIT_OPTIONS} onChange={(v) => set("base_unit", v)} />
          <SelectField label="Approvisionnement" value={str("supply_policy")} options={SUPPLY_POLICY_OPTIONS} onChange={(v) => set("supply_policy", v)} />
          <ToggleField label="Stockable" value={core.is_stockable === true} onChange={(v) => set("is_stockable", v)} />
        </div>
      </Card>

      <Card title="Conditionnement">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <NumberField label="Qté colisage primaire" value={str("primary_packaging_qty")} onChange={(v) => set("primary_packaging_qty", v)} integer />
          <NumberField label="Qté colisage secondaire" value={str("secondary_packaging_qty")} onChange={(v) => set("secondary_packaging_qty", v)} integer />
          <NumberField label="Qté colisage tertiaire" value={str("tertiary_packaging_qty")} onChange={(v) => set("tertiary_packaging_qty", v)} integer />
          <NumberField label="Qté palette" value={str("pallet_qty")} onChange={(v) => set("pallet_qty", v)} integer />
        </div>
      </Card>

      <Card title="Indexation cuivre">
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
      </Card>
    </div>
  );

  const renderSuppliers = () => (
    <Card title="Fournisseur(s)">
      <p className="text-sm text-slate-500 mb-4">
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
    </Card>
  );

  const renderReview = () => {
    const activeSupplier = suppliers.find((s) => s.is_active) ?? suppliers[0];
    return (
      <Card title="Récapitulatif">
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
        <p className="mt-4 text-xs text-slate-400">
          La synchronisation vers Odoo est déclenchée automatiquement après la création et n&apos;empêche
          pas la création locale en cas d&apos;indisponibilité.
        </p>
      </Card>
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
      <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-500 p-10">
        <AlertCircle size={40} className="text-amber-300" />
        <p className="font-medium">Accès restreint</p>
        <p className="text-sm text-slate-400">La création de produit est réservée aux rôles admin et commercial.</p>
        <Link href="/catalog" className="text-sm text-[#E07200] hover:text-[#C56400] font-medium">
          Retour au catalogue
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-slate-500 mb-4">
        <Link href="/catalog" className="hover:text-slate-700 transition-colors">
          Catalogue
        </Link>
        <ChevronRight size={14} className="text-slate-400" />
        <span className="text-slate-800 font-medium">Nouveau produit</span>
      </nav>

      <div className="flex items-center justify-between gap-3 flex-wrap mb-6">
        <div className="flex items-center gap-2">
          <Package size={20} className="text-[#E07200]" />
          <h1 className="text-xl font-semibold text-slate-900">Créer un produit</h1>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
          <span>Formulaire complet</span>
          <button
            type="button"
            role="switch"
            aria-checked={fullForm}
            onClick={() => setFullForm((f) => !f)}
            className={cn(
              "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
              fullForm ? "bg-[#E07200]" : "bg-slate-300",
            )}
          >
            <span
              className={cn(
                "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
                fullForm ? "translate-x-6" : "translate-x-1",
              )}
            />
          </button>
        </label>
      </div>

      {/* Progress indicator (wizard mode only) */}
      {!fullForm && (
        <ol className="flex items-center gap-2 mb-6 overflow-x-auto">
          {STEPS.map((s, idx) => {
            const active = idx === step;
            const done = idx < step;
            const err = showErrors && stepHasError(idx);
            return (
              <li key={s.id} className="flex items-center gap-2 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setStep(idx)}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                    active
                      ? "bg-[#E07200] text-white"
                      : done
                        ? "bg-[#FFF3E0] text-[#C56400]"
                        : "text-slate-500 hover:bg-slate-100",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-5 w-5 items-center justify-center rounded-full text-xs",
                      active ? "bg-white/20" : done ? "bg-[#E07200] text-white" : "bg-slate-200 text-slate-600",
                      err && "bg-red-500 text-white",
                    )}
                  >
                    {done ? <Check size={12} /> : idx + 1}
                  </span>
                  {s.label}
                </button>
                {idx < STEPS.length - 1 && <ChevronRight size={14} className="text-slate-300" />}
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
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-400 mb-3">
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
        <div className="mt-6 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
          <span>{submitError}</span>
        </div>
      )}

      {/* Footer navigation */}
      <div className="flex items-center justify-between gap-3 mt-8 pt-4 border-t border-[#E2E8F0]">
        {!fullForm && step > 0 ? (
          <button
            type="button"
            onClick={goPrev}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-600 border border-[#E2E8F0] rounded-lg hover:bg-slate-50"
          >
            <ArrowLeft size={15} />
            Précédent
          </button>
        ) : (
          <Link
            href="/catalog"
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-600 border border-[#E2E8F0] rounded-lg hover:bg-slate-50"
          >
            <ArrowLeft size={15} />
            Annuler
          </Link>
        )}

        {fullForm || step === STEPS.length - 1 ? (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-[#E07200] rounded-lg hover:bg-[#C56400] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting && <Loader2 size={15} className="animate-spin" />}
            {submitting ? "Création…" : "Créer et synchroniser vers Odoo"}
          </button>
        ) : (
          <button
            type="button"
            onClick={goNext}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-[#E07200] rounded-lg hover:bg-[#C56400]"
          >
            Suivant
            <ArrowRight size={15} />
          </button>
        )}
      </div>
    </div>
  );
}

function Recap({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3 py-1.5 border-b border-[#F1F5F9]">
      <dt className="text-slate-500">{label}</dt>
      <dd className={cn("font-medium text-slate-800 text-right", mono && "font-mono")}>
        {value || <span className="text-slate-300">—</span>}
      </dd>
    </div>
  );
}
