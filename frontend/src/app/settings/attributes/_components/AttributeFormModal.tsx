"use client";

import { useMemo, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import {
  createAttribute,
  updateAttribute,
  type AttributeCategory,
  type AttributeDataType,
  type AttributeOption,
  type AttributeRegistry,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import Modal from "./Modal";
import { CATEGORIES, CODE_REGEX, DATA_TYPES, slugifyCode } from "./constants";

const inputCls =
  "w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed";
const labelCls = "block text-xs font-semibold text-slate-600 mb-1.5";

interface OptionDraft {
  value: string;
  labelFr: string;
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between gap-3 w-full text-left"
    >
      <span>
        <span className="block text-sm font-medium text-slate-700">{label}</span>
        {hint && <span className="block text-xs text-slate-400">{hint}</span>}
      </span>
      <span
        role="switch"
        aria-checked={checked}
        className={cn(
          "relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors",
          checked ? "bg-primary" : "bg-slate-300"
        )}
      >
        <span
          className={cn(
            "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-6" : "translate-x-1"
          )}
        />
      </span>
    </button>
  );
}

/**
 * Create / edit dialog for an attribute definition (CDC §4.1.4 / §4.5).
 * `code` is auto-derived from the French label at creation and locked
 * (immutable) when editing.
 */
export default function AttributeFormModal({
  attribute,
  defaultCategory,
  onClose,
  onSaved,
}: {
  attribute?: AttributeRegistry;
  /** Pre-select category when creating from a filtered tab. */
  defaultCategory?: AttributeCategory;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!attribute;

  const [labelFr, setLabelFr] = useState(attribute?.label?.fr ?? "");
  const [labelEn, setLabelEn] = useState(attribute?.label?.en ?? "");
  const [labelEs, setLabelEs] = useState(attribute?.label?.es ?? "");
  const [code, setCode] = useState(attribute?.code ?? "");
  const [codeTouched, setCodeTouched] = useState(isEdit);
  const [category, setCategory] = useState<AttributeCategory>(
    attribute?.category ?? defaultCategory ?? "technical"
  );
  const [dataType, setDataType] = useState<AttributeDataType>(
    attribute?.data_type ?? "text"
  );
  const [unit, setUnit] = useState(attribute?.unit ?? "");
  const [options, setOptions] = useState<OptionDraft[]>(
    (attribute?.options ?? []).map((o) => ({
      value: o.value,
      labelFr: o.label?.fr ?? o.value,
    }))
  );
  const [isRequired, setIsRequired] = useState(attribute?.is_required ?? false);
  const [isSearchable, setIsSearchable] = useState(attribute?.is_searchable ?? true);
  const [isFilterable, setIsFilterable] = useState(attribute?.is_filterable ?? false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsOptions = dataType === "select" || dataType === "multiselect";

  // Auto-derive the code from the FR label until the user edits it manually.
  const onLabelFrChange = (v: string) => {
    setLabelFr(v);
    if (!isEdit && !codeTouched) setCode(slugifyCode(v));
  };

  const codeValid = CODE_REGEX.test(code);
  const optionsValid =
    !needsOptions ||
    (options.length > 0 && options.every((o) => o.value.trim() !== ""));
  const canSubmit =
    labelFr.trim() !== "" && (isEdit || codeValid) && optionsValid && !saving;

  const helperCode = useMemo(() => {
    if (isEdit) return "Le code est immuable après création.";
    if (code && !codeValid)
      return "Format invalide : minuscules, chiffres et underscores, commençant par une lettre.";
    return "Généré depuis le label, modifiable. Immuable après création.";
  }, [isEdit, code, codeValid]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const label: Record<string, string> = { fr: labelFr.trim() };
    if (labelEn.trim()) label.en = labelEn.trim();
    if (labelEs.trim()) label.es = labelEs.trim();

    const builtOptions: AttributeOption[] | null = needsOptions
      ? options.map((o) => ({
          value: o.value.trim(),
          label: { fr: (o.labelFr.trim() || o.value.trim()) },
        }))
      : null;

    const payload: Partial<AttributeRegistry> = {
      label,
      category,
      data_type: dataType,
      options: builtOptions,
      unit: dataType === "number" ? unit.trim() : "",
      is_required: isRequired,
      is_searchable: isSearchable,
      is_filterable: isFilterable,
    };

    try {
      if (isEdit && attribute) {
        await updateAttribute(attribute.id, payload);
      } else {
        await createAttribute({ ...payload, code: code.trim() });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur lors de l'enregistrement.");
      setSaving(false);
    }
  };

  return (
    <Modal title={isEdit ? "Modifier l'attribut" : "Nouvel attribut"} onClose={onClose}>
      {error && (
        <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <label className={labelCls}>Label (français) *</label>
          <input
            value={labelFr}
            onChange={(e) => onLabelFrChange(e.target.value)}
            required
            className={inputCls}
            placeholder="Diamètre du conducteur"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Label (anglais)</label>
            <input value={labelEn} onChange={(e) => setLabelEn(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Label (espagnol)</label>
            <input value={labelEs} onChange={(e) => setLabelEs(e.target.value)} className={inputCls} />
          </div>
        </div>

        <div>
          <label className={labelCls}>Code *</label>
          <input
            value={code}
            onChange={(e) => {
              setCodeTouched(true);
              setCode(e.target.value);
            }}
            disabled={isEdit}
            required
            className={cn(inputCls, "font-mono", !isEdit && code && !codeValid && "border-red-400")}
            placeholder="conductor_diameter"
          />
          <p className={cn("mt-1 text-xs", !isEdit && code && !codeValid ? "text-red-500" : "text-slate-400")}>
            {helperCode}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Catégorie *</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as AttributeCategory)}
              className={inputCls}
            >
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Type *</label>
            <select
              value={dataType}
              onChange={(e) => setDataType(e.target.value as AttributeDataType)}
              className={inputCls}
            >
              {DATA_TYPES.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {dataType === "number" && (
          <div>
            <label className={labelCls}>Unité</label>
            <input
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              className={inputCls}
              placeholder="mm, kg, A…"
            />
          </div>
        )}

        {needsOptions && (
          <div>
            <label className={labelCls}>Options * (au moins une)</label>
            <div className="flex flex-col gap-2">
              {options.map((opt, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    value={opt.value}
                    onChange={(e) =>
                      setOptions((prev) =>
                        prev.map((o, i) => (i === idx ? { ...o, value: e.target.value } : o))
                      )
                    }
                    className={cn(inputCls, "font-mono")}
                    placeholder="valeur"
                  />
                  <input
                    value={opt.labelFr}
                    onChange={(e) =>
                      setOptions((prev) =>
                        prev.map((o, i) => (i === idx ? { ...o, labelFr: e.target.value } : o))
                      )
                    }
                    className={inputCls}
                    placeholder="Libellé FR"
                  />
                  <button
                    type="button"
                    onClick={() => setOptions((prev) => prev.filter((_, i) => i !== idx))}
                    aria-label="Supprimer l'option"
                    className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg flex-shrink-0"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setOptions((prev) => [...prev, { value: "", labelFr: "" }])}
              className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-warm border border-dashed border-primary/40 rounded-lg hover:bg-accent/50"
            >
              <Plus size={13} />
              Ajouter une option
            </button>
          </div>
        )}

        <div className="flex flex-col gap-3 pt-1 border-t border-border">
          <Toggle label="Obligatoire" checked={isRequired} onChange={setIsRequired} hint="Champ requis sur la fiche produit." />
          <Toggle label="Recherchable" checked={isSearchable} onChange={setIsSearchable} hint="Inclus dans la recherche full-text." />
          <Toggle label="Filtrable" checked={isFilterable} onChange={setIsFilterable} hint="Exposé comme filtre dans la sidebar du catalogue." />
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 text-sm border border-border rounded-lg hover:bg-slate-50 text-slate-600"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm bg-primary hover:bg-primary/90 text-white rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {isEdit ? "Mettre à jour" : "Créer"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
