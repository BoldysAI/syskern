"use client";

import { useMemo, useState } from "react";
import { CircleNotch, Plus, Trash } from "@phosphor-icons/react";
import {
  createAttribute,
  updateAttribute,
  type AttributeCategory,
  type AttributeDataType,
  type AttributeOption,
  type AttributeRegistry,
} from "@/lib/api";
import { AppModal } from "@/components/AppModal";
import { FormField } from "@/components/FormField";
import { AppIcon } from "@/components/AppIcon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { OptionSelect } from "@/components/OptionSelect";
import { cn } from "@/lib/utils";
import { CATEGORIES, CODE_REGEX, DATA_TYPES, slugifyCode } from "./constants";

interface OptionDraft {
  value: string;
  labelFr: string;
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
    attribute?.category ?? defaultCategory ?? "technical",
  );
  const [dataType, setDataType] = useState<AttributeDataType>(attribute?.data_type ?? "text");
  const [unit, setUnit] = useState(attribute?.unit ?? "");
  const [options, setOptions] = useState<OptionDraft[]>(
    (attribute?.options ?? []).map((o) => ({
      value: o.value,
      labelFr: o.label?.fr ?? o.value,
    })),
  );
  const [isRequired, setIsRequired] = useState(attribute?.is_required ?? false);
  const [isSearchable, setIsSearchable] = useState(attribute?.is_searchable ?? true);
  const [isFilterable, setIsFilterable] = useState(attribute?.is_filterable ?? false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsOptions = dataType === "select" || dataType === "multiselect";

  const onLabelFrChange = (v: string) => {
    setLabelFr(v);
    if (!isEdit && !codeTouched) setCode(slugifyCode(v));
  };

  const codeValid = CODE_REGEX.test(code);
  const optionsValid =
    !needsOptions || (options.length > 0 && options.every((o) => o.value.trim() !== ""));
  const canSubmit = labelFr.trim() !== "" && (isEdit || codeValid) && optionsValid && !saving;

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
    <AppModal
      open
      onOpenChange={(open) => !open && onClose()}
      title={isEdit ? "Modifier l'attribut" : "Nouvel attribut"}
      size="xl"
    >
      {error && (
        <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      <form onSubmit={submit} className="flex flex-col gap-4">
        <FormField label="Label (français)" required>
          <Input
            value={labelFr}
            onChange={(e) => onLabelFrChange(e.target.value)}
            required
            placeholder="Diamètre du conducteur"
          />
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Label (anglais)">
            <Input value={labelEn} onChange={(e) => setLabelEn(e.target.value)} />
          </FormField>
          <FormField label="Label (espagnol)">
            <Input value={labelEs} onChange={(e) => setLabelEs(e.target.value)} />
          </FormField>
        </div>

        <FormField
          label="Code"
          required
          hint={helperCode}
          error={!isEdit && code && !codeValid ? "Format de code invalide." : undefined}
        >
          <Input
            value={code}
            onChange={(e) => {
              setCodeTouched(true);
              setCode(e.target.value);
            }}
            disabled={isEdit}
            required
            className={cn("font-mono", !isEdit && code && !codeValid && "border-destructive")}
            placeholder="conductor_diameter"
          />
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Catégorie" required>
            <OptionSelect
              value={category}
              onValueChange={(v) => setCategory(v as AttributeCategory)}
              options={CATEGORIES.map((c) => ({ value: c.id, label: c.label }))}
            />
          </FormField>
          <FormField label="Type" required>
            <OptionSelect
              value={dataType}
              onValueChange={(v) => setDataType(v as AttributeDataType)}
              options={DATA_TYPES.map((d) => ({ value: d.id, label: d.label }))}
            />
          </FormField>
        </div>

        {dataType === "number" && (
          <FormField label="Unité">
            <Input
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="mm, kg, A…"
            />
          </FormField>
        )}

        {needsOptions && (
          <FormField label="Options" required hint="Au moins une option requise.">
            <div className="flex flex-col gap-2">
              {options.map((opt, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Input
                    value={opt.value}
                    onChange={(e) =>
                      setOptions((prev) =>
                        prev.map((o, i) => (i === idx ? { ...o, value: e.target.value } : o)),
                      )
                    }
                    className="font-mono"
                    placeholder="valeur"
                  />
                  <Input
                    value={opt.labelFr}
                    onChange={(e) =>
                      setOptions((prev) =>
                        prev.map((o, i) => (i === idx ? { ...o, labelFr: e.target.value } : o)),
                      )
                    }
                    placeholder="Libellé FR"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setOptions((prev) => prev.filter((_, i) => i !== idx))}
                    aria-label="Supprimer l'option"
                  >
                    <AppIcon icon={Trash} size="sm" className="text-muted-foreground" />
                  </Button>
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => setOptions((prev) => [...prev, { value: "", labelFr: "" }])}
            >
              <AppIcon icon={Plus} size="sm" />
              Ajouter une option
            </Button>
          </FormField>
        )}

        <div className="flex flex-col gap-3 border-t border-border pt-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label className="text-sm font-medium">Obligatoire</Label>
              <p className="text-xs text-muted-foreground">Champ requis sur la fiche produit.</p>
            </div>
            <Switch checked={isRequired} onCheckedChange={setIsRequired} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label className="text-sm font-medium">Recherchable</Label>
              <p className="text-xs text-muted-foreground">Inclus dans la recherche full-text.</p>
            </div>
            <Switch checked={isSearchable} onCheckedChange={setIsSearchable} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label className="text-sm font-medium">Filtrable</Label>
              <p className="text-xs text-muted-foreground">
                Exposé comme filtre dans la sidebar du catalogue.
              </p>
            </div>
            <Switch checked={isFilterable} onCheckedChange={setIsFilterable} />
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" disabled={!canSubmit} className="flex-1">
            {saving && <AppIcon icon={CircleNotch} size="sm" className="animate-spin" />}
            {isEdit ? "Mettre à jour" : "Créer"}
          </Button>
        </div>
      </form>
    </AppModal>
  );
}
