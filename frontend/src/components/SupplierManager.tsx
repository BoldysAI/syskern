"use client";

import { useState } from "react";
import useSWR from "swr";
import * as Select from "@radix-ui/react-select";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, ChevronDown, Loader2, Plus, Star, Trash2, X } from "lucide-react";
import {
  getSupplierNames,
  getSupplierTemplate,
  listIncoterms,
  type Currency,
  type ProductSupplier,
  type ProductSupplierInput,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { localizeIncotermLabel } from "@/lib/incoterms";

/** Incoterms 2020 — loaded from API with static fallback. */
const INCOTERMS_FALLBACK = [
  "EXW",
  "FCA",
  "FAS",
  "FOB",
  "CFR",
  "CIF",
  "CPT",
  "CIP",
  "DAP",
  "DPU",
  "DDP",
] as const;

const CURRENCIES: Currency[] = ["EUR", "USD", "RMB"];

const inputCls =
  "w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary";

export interface SupplierManagerProps {
  suppliers: ProductSupplier[];
  onCreate: (data: ProductSupplierInput) => Promise<void> | void;
  onUpdate: (id: string, data: ProductSupplierInput) => Promise<void> | void;
  onDelete: (id: string) => Promise<void> | void;
  onActivate: (id: string) => Promise<void> | void;
  /** When true, all controls are disabled (viewer role). */
  readOnly?: boolean;
  /** Limit the number of suppliers (e.g. 1 in the creation wizard step 4). */
  maxSuppliers?: number;
}

function emptySupplier(makeActive: boolean): ProductSupplierInput {
  return {
    supplier_name: "",
    factory_code: "",
    po_base_price: null,
    po_currency: "RMB",
    // `null` = hérite du produit (FEEDBACK 2) — c'est le défaut voulu : on ne
    // surcharge le cuivre que si CE fournisseur déclare sa propre valeur.
    is_copper_indexed: null,
    copper_weight_kg_per_unit: null,
    copper_base_price: null,
    incoterm: "",
    incoterm_location: "",
    notes: "",
    is_active: makeActive,
  };
}

function toInput(s: ProductSupplier): ProductSupplierInput {
  return {
    supplier_name: s.supplier_name,
    factory_code: s.factory_code ?? "",
    po_base_price: s.po_base_price ?? null,
    po_currency: s.po_currency ?? "RMB",
    is_copper_indexed: s.is_copper_indexed ?? null,
    copper_weight_kg_per_unit: s.copper_weight_kg_per_unit ?? null,
    copper_base_price: s.copper_base_price ?? null,
    incoterm: s.incoterm ?? "",
    incoterm_location: s.incoterm_location ?? "",
    notes: s.notes ?? "",
    is_active: s.is_active,
  };
}

function sanitize(data: ProductSupplierInput): ProductSupplierInput {
  const trimPrice = (v?: string | null) =>
    v == null || String(v).trim() === "" ? null : String(v);
  return {
    ...data,
    supplier_name: data.supplier_name.trim(),
    po_base_price: trimPrice(data.po_base_price),
    // Explicitement « non indexé » → on purge les valeurs cuivre. « Hérite »
    // (null) les conserve : elles ne servent simplement pas.
    copper_base_price: data.is_copper_indexed === false ? null : trimPrice(data.copper_base_price),
    copper_weight_kg_per_unit:
      data.is_copper_indexed === false ? null : trimPrice(data.copper_weight_kg_per_unit),
  };
}

/** Fields sent on PATCH — `is_active` is managed only via the activate endpoint. */
function toUpdatePayload(data: ProductSupplierInput): Omit<ProductSupplierInput, "is_active"> {
  const { is_active: _ignored, ...payload } = sanitize(data);
  return payload;
}

/** Compare editable fields only (activation is a separate action). */
function editableSnapshot(data: ProductSupplierInput): string {
  const { is_active: _ignored, ...rest } = sanitize(data);
  return JSON.stringify(rest);
}

function isValid(data: ProductSupplierInput): boolean {
  if (!data.supplier_name.trim()) return false;
  for (const v of [data.po_base_price, data.copper_base_price, data.copper_weight_kg_per_unit]) {
    if (v != null && String(v).trim() !== "" && !Number.isFinite(Number(v))) return false;
  }
  return true;
}

// ─── Indexation cuivre à 3 états (FEEDBACK 2) ───────────────────────────────
// `is_copper_indexed` est nullable côté API : `null` = hérite du produit.

type CopperMode = "inherit" | "indexed" | "not_indexed";

const COPPER_MODES: { id: CopperMode; label: string }[] = [
  { id: "inherit", label: "Hériter du produit" },
  { id: "indexed", label: "Indexé" },
  { id: "not_indexed", label: "Non indexé" },
];

function copperMode(data: ProductSupplierInput): CopperMode {
  if (data.is_copper_indexed === true) return "indexed";
  if (data.is_copper_indexed === false) return "not_indexed";
  return "inherit";
}

function copperModePatch(
  mode: CopperMode,
  current: ProductSupplierInput,
): Partial<ProductSupplierInput> {
  if (mode === "indexed") return { is_copper_indexed: true };
  // Hériter / non indexé : aucune valeur cuivre propre au fournisseur ne doit
  // subsister, sinon elle réapparaîtrait en repassant sur « Indexé ».
  return {
    is_copper_indexed: mode === "inherit" ? null : false,
    copper_weight_kg_per_unit: null,
    copper_base_price: mode === "inherit" ? current.copper_base_price : null,
  };
}

// ─── Shared field set (used by both the edit cards and the add form) ─────────

function templateToInput(template: ProductSupplier, makeActive: boolean): ProductSupplierInput {
  return {
    supplier_name: template.supplier_name,
    factory_code: template.factory_code ?? "",
    po_base_price: template.po_base_price ?? null,
    po_currency: template.po_currency ?? "RMB",
    is_copper_indexed: template.is_copper_indexed ?? null,
    copper_weight_kg_per_unit: template.copper_weight_kg_per_unit ?? null,
    copper_base_price: template.copper_base_price ?? null,
    incoterm: template.incoterm ?? "",
    incoterm_location: template.incoterm_location ?? "",
    notes: template.notes ?? "",
    is_active: makeActive,
  };
}

function SupplierFields({
  value,
  onChange,
  disabled,
  nameMode,
  existingNames,
  onSelectExisting,
  loadingTemplate,
}: {
  value: ProductSupplierInput;
  onChange: (patch: Partial<ProductSupplierInput>) => void;
  disabled?: boolean;
  nameMode?: "existing" | "new";
  existingNames?: string[];
  onSelectExisting?: (name: string) => void;
  loadingTemplate?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <label className="flex flex-col gap-1 sm:col-span-2">
        <span className="text-xs font-medium text-muted-foreground">Nom du fournisseur *</span>
        {nameMode === "existing" && existingNames && existingNames.length > 0 ? (
          <div className="relative">
            <Select.Root
              value={value.supplier_name || undefined}
              onValueChange={(v) => onSelectExisting?.(v)}
              disabled={disabled || loadingTemplate}
            >
              <Select.Trigger
                className={cn(
                  inputCls,
                  "flex items-center justify-between gap-2 text-left disabled:opacity-50",
                )}
              >
                <Select.Value placeholder="Choisir un fournisseur existant…" />
                <Select.Icon>
                  {loadingTemplate ? (
                    <Loader2 size={15} className="animate-spin text-muted-foreground" />
                  ) : (
                    <ChevronDown size={15} className="text-muted-foreground" />
                  )}
                </Select.Icon>
              </Select.Trigger>
              <Select.Portal>
                <Select.Content
                  position="popper"
                  sideOffset={4}
                  className="z-50 min-w-[var(--radix-select-trigger-width)] bg-popover border border-border rounded-lg shadow-lg overflow-hidden"
                >
                  <Select.Viewport className="p-1 max-h-56">
                    {existingNames.map((name) => (
                      <Select.Item
                        key={name}
                        value={name}
                        className="flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-md cursor-pointer select-none outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
                      >
                        <Select.ItemText>{name}</Select.ItemText>
                        <Select.ItemIndicator>
                          <Check size={14} className="text-brand-green" />
                        </Select.ItemIndicator>
                      </Select.Item>
                    ))}
                  </Select.Viewport>
                </Select.Content>
              </Select.Portal>
            </Select.Root>
          </div>
        ) : (
          <input
            value={value.supplier_name}
            disabled={disabled}
            onChange={(e) => onChange({ supplier_name: e.target.value })}
            className={inputCls}
            placeholder="ex. Symea Shanghai"
          />
        )}
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Code usine</span>
        <input
          value={value.factory_code ?? ""}
          disabled={disabled}
          onChange={(e) => onChange({ factory_code: e.target.value })}
          className={inputCls}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">PO base</span>
        <span className="text-[11px] leading-tight text-muted-foreground">
          Prix d&apos;achat fournisseur (devise d&apos;origine) — point de départ du calcul PA
        </span>
        <input
          type="number"
          inputMode="decimal"
          value={value.po_base_price ?? ""}
          disabled={disabled}
          onChange={(e) =>
            onChange({ po_base_price: e.target.value === "" ? null : e.target.value })
          }
          className={inputCls}
          placeholder="ex. 2350"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Devise PO</span>
        <CurrencySelect
          value={value.po_currency ?? "RMB"}
          disabled={disabled}
          onChange={(c) => onChange({ po_currency: c })}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Incoterm</span>
        <IncotermSelect
          value={value.incoterm ?? ""}
          disabled={disabled}
          onChange={(i) => onChange({ incoterm: i })}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Localisation incoterm</span>
        <input
          value={value.incoterm_location ?? ""}
          disabled={disabled}
          onChange={(e) => onChange({ incoterm_location: e.target.value })}
          className={inputCls}
          placeholder="ex. Shanghai"
        />
      </label>

      {/* Indexation cuivre à 3 états (FEEDBACK 2) : deux fournisseurs du même SKU
          peuvent déclarer un poids cuivre différent. « Hériter » = la valeur du
          produit s'applique — c'est le défaut, et ce que fait tout lien existant. */}
      <div className="flex flex-col gap-1 sm:col-span-2">
        <span className="text-xs font-medium text-muted-foreground">Indexation cuivre</span>
        <div
          role="radiogroup"
          aria-label="Indexation cuivre"
          className="inline-flex w-full rounded-md bg-muted p-0.5"
        >
          {COPPER_MODES.map((mode) => {
            const selected = copperMode(value) === mode.id;
            return (
              <button
                key={mode.id}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={disabled}
                onClick={() => onChange(copperModePatch(mode.id, value))}
                className={cn(
                  "flex-1 rounded px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50",
                  selected
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {mode.label}
              </button>
            );
          })}
        </div>
      </div>

      {value.is_copper_indexed === true && (
        <>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">
              Poids cuivre / unité (kg)
            </span>
            <input
              type="number"
              inputMode="decimal"
              value={value.copper_weight_kg_per_unit ?? ""}
              disabled={disabled}
              onChange={(e) =>
                onChange({
                  copper_weight_kg_per_unit: e.target.value === "" ? null : e.target.value,
                })
              }
              className={inputCls}
              placeholder="hérite du produit si vide"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Base cuivre</span>
            <input
              type="number"
              inputMode="decimal"
              value={value.copper_base_price ?? ""}
              disabled={disabled}
              onChange={(e) =>
                onChange({ copper_base_price: e.target.value === "" ? null : e.target.value })
              }
              className={inputCls}
            />
          </label>
        </>
      )}

      <label className="flex flex-col gap-1 sm:col-span-2">
        <span className="text-xs font-medium text-muted-foreground">Notes</span>
        <textarea
          value={value.notes ?? ""}
          disabled={disabled}
          rows={2}
          onChange={(e) => onChange({ notes: e.target.value })}
          className={cn(inputCls, "resize-y")}
        />
      </label>
    </div>
  );
}

function CurrencySelect({
  value,
  onChange,
  disabled,
}: {
  value: Currency;
  onChange: (c: Currency) => void;
  disabled?: boolean;
}) {
  return (
    <Select.Root value={value} onValueChange={(v) => onChange(v as Currency)} disabled={disabled}>
      <Select.Trigger
        className={cn(
          inputCls,
          "flex items-center justify-between gap-2 text-left disabled:opacity-50",
        )}
      >
        <Select.Value />
        <Select.Icon>
          <ChevronDown size={15} className="text-muted-foreground" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          position="popper"
          sideOffset={4}
          className="z-50 min-w-[var(--radix-select-trigger-width)] bg-popover border border-border rounded-lg shadow-lg overflow-hidden"
        >
          <Select.Viewport className="p-1">
            {CURRENCIES.map((c) => (
              <Select.Item
                key={c}
                value={c}
                className="flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-md cursor-pointer select-none outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
              >
                <Select.ItemText>{c}</Select.ItemText>
                <Select.ItemIndicator>
                  <Check size={14} className="text-brand-green" />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

function IncotermSelect({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (i: string) => void;
  disabled?: boolean;
}) {
  const { data: incoterms } = useSWR("incoterms-supplier", listIncoterms);
  const codes = incoterms?.map((i) => i.code) ?? [...INCOTERMS_FALLBACK];

  return (
    <Select.Root value={value || undefined} onValueChange={onChange} disabled={disabled}>
      <Select.Trigger
        className={cn(
          inputCls,
          "flex items-center justify-between gap-2 text-left disabled:opacity-50",
        )}
      >
        <Select.Value placeholder="—" />
        <Select.Icon>
          <ChevronDown size={15} className="text-muted-foreground" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          position="popper"
          sideOffset={4}
          className="z-50 max-h-64 min-w-[var(--radix-select-trigger-width)] bg-popover border border-border rounded-lg shadow-lg overflow-hidden"
        >
          <Select.Viewport className="p-1">
            {codes.map((code) => {
              const ref = incoterms?.find((i) => i.code === code);
              const label = ref ? localizeIncotermLabel(ref.label, code) : code;
              return (
                <Select.Item
                  key={code}
                  value={code}
                  className="flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-md cursor-pointer select-none outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
                >
                  <Select.ItemText>
                    {code} — {label}
                  </Select.ItemText>
                  <Select.ItemIndicator>
                    <Check size={14} className="text-brand-green" />
                  </Select.ItemIndicator>
                </Select.Item>
              );
            })}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

// ─── One existing supplier (buffered edit + activate + delete) ───────────────

function SupplierCard({
  supplier,
  onUpdate,
  onDelete,
  onActivate,
  readOnly,
}: {
  supplier: ProductSupplier;
  onUpdate: (id: string, data: ProductSupplierInput) => Promise<void> | void;
  onDelete: (id: string) => Promise<void> | void;
  onActivate: (id: string) => Promise<void> | void;
  readOnly?: boolean;
}) {
  const [draft, setDraft] = useState<ProductSupplierInput>(() => toInput(supplier));
  const [busy, setBusy] = useState(false);

  // `is_active` du brouillon n'est jamais lu : l'affichage utilise la prop
  // `supplier.is_active`, et `editableSnapshot`/`toUpdatePayload` l'excluent
  // (l'activation passe par son propre endpoint). L'effet de synchro qui vivait
  // ici ne servait donc à rien — et violait `react-hooks/set-state-in-effect`.
  const dirty = editableSnapshot(draft) !== editableSnapshot(toInput(supplier));

  const run = async (fn: () => Promise<void> | void) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={cn(
        "rounded-xl border p-4 shadow-sm bg-popover",
        supplier.is_active ? "border-primary" : "border-border",
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-semibold",
            supplier.is_active
              ? "bg-accent text-accent-foreground"
              : "bg-muted text-muted-foreground",
          )}
        >
          {supplier.is_active && <Star size={12} className="fill-brand-green text-brand-green" />}
          {supplier.is_active ? "Source active" : "Inactive"}
        </span>
        {!readOnly && (
          <div className="flex items-center gap-2">
            {!supplier.is_active && (
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => onActivate(supplier.id))}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-brand-green border border-primary/40 rounded-lg hover:bg-accent/50 disabled:opacity-50"
              >
                <Star size={13} />
                Définir comme active
              </button>
            )}
            <DeleteSupplierButton
              label={supplier.supplier_name || "ce fournisseur"}
              disabled={busy}
              onConfirm={() => run(() => onDelete(supplier.id))}
            />
          </div>
        )}
      </div>

      <SupplierFields
        value={draft}
        onChange={(p) => setDraft((d) => ({ ...d, ...p }))}
        disabled={readOnly}
      />

      {!readOnly && dirty && (
        <div className="flex justify-end gap-2 mt-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => setDraft(toInput(supplier))}
            className="px-3 py-2 text-sm border border-border rounded-lg hover:bg-muted text-muted-foreground disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            type="button"
            disabled={busy || !isValid(draft)}
            onClick={() => run(() => onUpdate(supplier.id, toUpdatePayload(draft)))}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 disabled:opacity-50"
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            Enregistrer
          </button>
        </div>
      )}
    </div>
  );
}

function DeleteSupplierButton({
  label,
  onConfirm,
  disabled,
}: {
  label: string;
  onConfirm: () => Promise<void> | void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label="Supprimer le fournisseur"
          className="inline-flex items-center justify-center h-8 w-8 text-muted-foreground border border-border rounded-lg hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
        >
          <Trash2 size={14} />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-popover p-5 shadow-xl focus:outline-none">
          <Dialog.Title className="text-base font-semibold text-foreground">
            Supprimer le fournisseur
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-muted-foreground">
            Confirmez-vous la suppression de{" "}
            <span className="font-medium text-foreground">{label}</span> ? Cette action est
            irréversible.
          </Dialog.Description>
          <div className="flex justify-end gap-3 mt-5">
            <Dialog.Close className="px-3 py-2 text-sm border border-border rounded-lg hover:bg-muted text-muted-foreground">
              Annuler
            </Dialog.Close>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                void onConfirm();
              }}
              className="px-3 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700"
            >
              Supprimer
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ─── Public component ────────────────────────────────────────────────────────

export function SupplierManager({
  suppliers,
  onCreate,
  onUpdate,
  onDelete,
  onActivate,
  readOnly,
  maxSuppliers,
}: SupplierManagerProps) {
  const [adding, setAdding] = useState(false);
  const [newSupplier, setNewSupplier] = useState<ProductSupplierInput>(() =>
    emptySupplier(suppliers.length === 0),
  );
  const [busy, setBusy] = useState(false);
  const [linkMode, setLinkMode] = useState<"existing" | "new">("existing");
  const [loadingTemplate, setLoadingTemplate] = useState(false);

  const { data: existingNames } = useSWR<string[]>(
    !readOnly ? "supplier-names" : null,
    getSupplierNames,
  );
  const hasExisting = (existingNames?.length ?? 0) > 0;

  const atLimit = maxSuppliers != null && suppliers.length >= maxSuppliers;

  const handleSelectExisting = async (name: string) => {
    setLoadingTemplate(true);
    try {
      const template = await getSupplierTemplate(name);
      setNewSupplier(templateToInput(template, suppliers.length === 0));
    } catch {
      setNewSupplier((d) => ({ ...d, supplier_name: name }));
    } finally {
      setLoadingTemplate(false);
    }
  };

  const openAddForm = () => {
    setNewSupplier(emptySupplier(suppliers.length === 0));
    setLinkMode(hasExisting ? "existing" : "new");
    setAdding(true);
  };

  const handleCreate = async () => {
    setBusy(true);
    try {
      await onCreate(sanitize(newSupplier));
      setNewSupplier(emptySupplier(false));
      setAdding(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {suppliers.length === 0 && !adding && (
        <p className="text-sm text-muted-foreground">Aucun fournisseur enregistré.</p>
      )}

      {suppliers.map((s) => (
        <SupplierCard
          key={s.id}
          supplier={s}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onActivate={onActivate}
          readOnly={readOnly}
        />
      ))}

      {adding && !readOnly && (
        <div className="rounded-xl border border-dashed border-primary/40 p-4 bg-[#FFFBF5]">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-foreground">Nouveau fournisseur</h4>
            <button
              type="button"
              aria-label="Annuler l'ajout"
              onClick={() => {
                setAdding(false);
                setNewSupplier(emptySupplier(suppliers.length === 0));
                setLinkMode(hasExisting ? "existing" : "new");
              }}
              className="text-muted-foreground hover:text-muted-foreground"
            >
              <X size={18} />
            </button>
          </div>

          {hasExisting && (
            <div className="flex gap-2 mb-4">
              {(["existing", "new"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => {
                    setLinkMode(mode);
                    setNewSupplier(emptySupplier(suppliers.length === 0));
                  }}
                  className={cn(
                    "flex-1 py-2 text-sm font-medium rounded-lg border transition-colors",
                    linkMode === mode
                      ? "border-primary bg-accent text-accent-foreground"
                      : "border-border text-muted-foreground hover:bg-muted",
                  )}
                >
                  {mode === "existing" ? "Fournisseur existant" : "Nouveau fournisseur"}
                </button>
              ))}
            </div>
          )}

          <SupplierFields
            value={newSupplier}
            onChange={(p) => setNewSupplier((d) => ({ ...d, ...p }))}
            nameMode={linkMode}
            existingNames={existingNames}
            onSelectExisting={handleSelectExisting}
            loadingTemplate={loadingTemplate}
          />
          <div className="flex justify-end gap-2 mt-3">
            <button
              type="button"
              disabled={busy || !isValid(newSupplier)}
              onClick={handleCreate}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 disabled:opacity-50"
            >
              {busy && <Loader2 size={14} className="animate-spin" />}
              Ajouter le fournisseur
            </button>
          </div>
        </div>
      )}

      {!readOnly && !adding && !atLimit && (
        <button
          type="button"
          onClick={openAddForm}
          className="inline-flex items-center gap-2 self-start px-3 py-2 text-sm font-medium text-brand-green border border-dashed border-primary/40 rounded-lg hover:bg-accent/50"
        >
          <Plus size={15} />
          Ajouter un fournisseur
        </button>
      )}
    </div>
  );
}
