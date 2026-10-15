"use client";

import { useMemo, useState } from "react";
import { CircleNotch, Plus, Trash } from "@phosphor-icons/react";
import { toast } from "sonner";
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
import { MultilingualField, type MultilingualValue } from "@/components/MultilingualField";
import {
  AttributeRenderer,
  isAttributeValueEmpty,
} from "@/components/AttributeRenderer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { OptionSelect } from "@/components/OptionSelect";
import { useUiTranslate } from "@/lib/use-ui-translate";
import { cn } from "@/lib/utils";
import { CATEGORIES, CODE_REGEX, DATA_TYPES, DATA_TYPE_LABELS, slugifyCode } from "./constants";

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
  const t = useUiTranslate();

  const [label, setLabel] = useState<MultilingualValue>({
    fr: attribute?.label?.fr ?? "",
    en: attribute?.label?.en ?? "",
    es: attribute?.label?.es ?? "",
  });
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
  const [useDefaultValue, setUseDefaultValue] = useState(
    attribute?.default_value != null && !isAttributeValueEmpty(attribute.default_value),
  );
  const [defaultValue, setDefaultValue] = useState<unknown>(attribute?.default_value ?? null);
  const [defaultValid, setDefaultValid] = useState(true);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsOptions = dataType === "select" || dataType === "multiselect";

  const draftAttribute = useMemo<AttributeRegistry>(
    () => ({
      id: attribute?.id ?? "draft",
      code: code.trim() || "draft",
      label: {
        fr: (label.fr ?? "").trim(),
        ...((label.en ?? "").trim() ? { en: (label.en ?? "").trim() } : {}),
        ...((label.es ?? "").trim() ? { es: (label.es ?? "").trim() } : {}),
      },
      category,
      data_type: dataType,
      options: needsOptions
        ? options.map((o) => ({
            value: o.value.trim(),
            label: { fr: (o.labelFr.trim() || o.value.trim()) },
          }))
        : null,
      unit: dataType === "number" ? unit.trim() : "",
      is_required: isRequired,
      is_searchable: isSearchable,
      is_filterable: isFilterable,
      display_order: attribute?.display_order ?? 0,
    }),
    [
      attribute?.id,
      attribute?.display_order,
      code,
      label,
      category,
      dataType,
      needsOptions,
      options,
      unit,
      isRequired,
      isSearchable,
      isFilterable,
    ],
  );

  const handleLabelChange = (next: MultilingualValue) => {
    const nextFr = next.fr ?? "";
    if (!isEdit && !codeTouched && nextFr !== (label.fr ?? "")) setCode(slugifyCode(nextFr));
    setLabel(next);
  };

  const codeValid = CODE_REGEX.test(code);
  const optionsValid =
    !needsOptions || (options.length > 0 && options.every((o) => o.value.trim() !== ""));
  const defaultValueRequired = isRequired || useDefaultValue;
  const defaultValueOk =
    !defaultValueRequired ||
    (!isAttributeValueEmpty(defaultValue) && defaultValid);
  const canSubmit =
    (label.fr ?? "").trim() !== "" &&
    (isEdit || codeValid) &&
    optionsValid &&
    defaultValueOk &&
    !saving;

  const helperCode = useMemo(() => {
    if (isEdit) return t("settings.attributes.codeImmutable");
    if (code && !codeValid) return t("settings.attributes.codeInvalidHint");
    return t("settings.attributes.codeHint");
  }, [isEdit, code, codeValid, t]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const builtLabel: Record<string, string> = { fr: (label.fr ?? "").trim() };
    if ((label.en ?? "").trim()) builtLabel.en = (label.en ?? "").trim();
    if ((label.es ?? "").trim()) builtLabel.es = (label.es ?? "").trim();

    const builtOptions: AttributeOption[] | null = needsOptions
      ? options.map((o) => ({
          value: o.value.trim(),
          label: { fr: (o.labelFr.trim() || o.value.trim()) },
        }))
      : null;

    const payload: Partial<AttributeRegistry> = {
      label: builtLabel,
      category,
      data_type: dataType,
      options: builtOptions,
      unit: dataType === "number" ? unit.trim() : "",
      is_required: isRequired,
      is_searchable: isSearchable,
      is_filterable: isFilterable,
      default_value:
        useDefaultValue && !isAttributeValueEmpty(defaultValue) ? defaultValue : null,
    };

    try {
      if (isEdit && attribute) {
        await updateAttribute(attribute.id, payload);
      } else {
        await createAttribute({ ...payload, code: code.trim() });
        if (useDefaultValue && !isAttributeValueEmpty(defaultValue)) {
          toast.info(t("settings.attributes.applyingDefault"));
        }
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.attributes.saveError"));
      setSaving(false);
    }
  };

  return (
    <AppModal
      open
      onOpenChange={(open) => !open && onClose()}
      title={isEdit ? t("settings.attributes.editTitle") : t("settings.attributes.new")}
      size="xl"
    >
      {error && (
        <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      <form onSubmit={submit} className="flex flex-col gap-4">
        <MultilingualField
          label={t("settings.attributes.fieldLabel")}
          value={label}
          onChange={handleLabelChange}
          kind="input"
          requiredSource
          placeholder={t("settings.attributes.labelPlaceholder")}
        />

        <FormField
          label={t("settings.code")}
          required
          hint={helperCode}
          error={!isEdit && code && !codeValid ? t("settings.attributes.codeInvalid") : undefined}
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
            placeholder={t("settings.attributes.codePlaceholder")}
          />
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          <FormField label={t("settings.category")} required>
            <OptionSelect
              value={category}
              onValueChange={(v) => setCategory(v as AttributeCategory)}
              options={CATEGORIES.map((c) => ({ value: c.id, label: t(c.labelKey) }))}
            />
          </FormField>
          <FormField label={t("settings.type")} required>
            <OptionSelect
              value={dataType}
              onValueChange={(v) => {
                setDataType(v as AttributeDataType);
                if (useDefaultValue) {
                  setDefaultValue(null);
                  setDefaultValid(true);
                }
              }}
              options={DATA_TYPES.map((d) => ({ value: d.id, label: t(d.labelKey) }))}
            />
          </FormField>
        </div>

        {dataType === "number" && (
          <FormField label={t("settings.market.unit")}>
            <Input
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder={t("settings.attributes.unitPlaceholder")}
            />
          </FormField>
        )}

        {needsOptions && (
          <FormField label={t("settings.attributes.options")} required hint={t("settings.attributes.optionsRequired")}>
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
                    placeholder={t("settings.attributes.optionValuePlaceholder")}
                  />
                  <Input
                    value={opt.labelFr}
                    onChange={(e) =>
                      setOptions((prev) =>
                        prev.map((o, i) => (i === idx ? { ...o, labelFr: e.target.value } : o)),
                      )
                    }
                    placeholder={t("settings.attributes.optionLabelPlaceholder")}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setOptions((prev) => prev.filter((_, i) => i !== idx))}
                    aria-label={t("settings.attributes.deleteOption")}
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
              {t("settings.attributes.addOption")}
            </Button>
          </FormField>
        )}

        <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label className="text-sm font-medium">{t("settings.attributes.defaultValue")}</Label>
              <p className="text-xs text-muted-foreground">
                {isEdit
                  ? t("settings.attributes.defaultEditHint")
                  : t("settings.attributes.defaultCreateHint")}
              </p>
            </div>
            <Switch
              checked={useDefaultValue}
              onCheckedChange={(on) => {
                setUseDefaultValue(on);
                if (!on) {
                  setDefaultValue(null);
                  setDefaultValid(true);
                }
              }}
            />
          </div>
          {useDefaultValue && (
            <FormField
              label={t("settings.attributes.value")}
              hint={t("settings.attributes.expectedType", { type: t(DATA_TYPE_LABELS[dataType]) })}
              error={
                defaultValueRequired && isAttributeValueEmpty(defaultValue)
                  ? isRequired
                    ? t("settings.attributes.requiredDefault")
                    : t("settings.attributes.defaultRequired")
                  : !defaultValid
                    ? t("settings.attributes.invalidValue")
                    : undefined
              }
            >
              <AttributeRenderer
                attribute={draftAttribute}
                value={defaultValue}
                mode="edit"
                onChange={(v, valid) => {
                  setDefaultValue(v);
                  setDefaultValid(valid);
                }}
              />
            </FormField>
          )}
        </div>

        <div className="flex flex-col gap-3 border-t border-border pt-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label className="text-sm font-medium">{t("settings.attributes.required")}</Label>
              <p className="text-xs text-muted-foreground">{t("settings.attributes.requiredHint")}</p>
            </div>
            <Switch
              checked={isRequired}
              onCheckedChange={(on) => {
                setIsRequired(on);
                if (on) setUseDefaultValue(true);
              }}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label className="text-sm font-medium">{t("settings.attributes.searchable")}</Label>
              <p className="text-xs text-muted-foreground">{t("settings.attributes.searchableHint")}</p>
            </div>
            <Switch checked={isSearchable} onCheckedChange={setIsSearchable} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label className="text-sm font-medium">{t("settings.attributes.filterable")}</Label>
              <p className="text-xs text-muted-foreground">
                {t("settings.attributes.filterableHint")}
              </p>
            </div>
            <Switch checked={isFilterable} onCheckedChange={setIsFilterable} />
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={!canSubmit} className="flex-1">
            {saving && <AppIcon icon={CircleNotch} size="sm" className="animate-spin" />}
            {isEdit ? t("settings.update") : t("common.create")}
          </Button>
        </div>
      </form>
    </AppModal>
  );
}
