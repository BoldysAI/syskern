"use client";

import { useUiTranslate } from "@/lib/use-ui-translate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "./Field";
import { AttributeSection } from "./AttributeSection";

const BASE_UNIT_OPTIONS = [
  { value: "unit", labelKey: "catalog.unit.unit" },
  { value: "km", labelKey: "catalog.unit.km" },
  { value: "m", labelKey: "catalog.unit.m" },
] as const;

const SUPPLY_POLICY_OPTIONS = [
  { value: "buy", labelKey: "catalog.supply.buy" },
  { value: "dropship", labelKey: "catalog.supply.dropship" },
  { value: "mixed", labelKey: "catalog.supply.mixed" },
] as const;

export function LogisticsTab() {
  const t = useUiTranslate();
  const baseUnitOptions = BASE_UNIT_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }));
  const supplyPolicyOptions = SUPPLY_POLICY_OPTIONS.map((o) => ({
    value: o.value,
    label: t(o.labelKey),
  }));
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="border-none pb-0">
            <CardTitle className="text-sm font-semibold">
              {t("catalog.logistics.unitWeightSupply")}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            <Field
              field="base_unit"
              label={t("catalog.field.baseUnit")}
              kind="select"
              options={baseUnitOptions}
            />
            <Field field="uom" label={t("catalog.field.uom")} kind="text" readOnly />
            {/* Poids unitaire : de retour en Logistique (FEEDBACK 2), sa place
                d'origine. Le round 1 l'avait déplacé en Technique par erreur. */}
            <Field field="unit_weight_kg" label={t("catalog.field.unitWeight")} kind="number" unit="kg" />
            <Field
              field="supply_policy"
              label={t("catalog.field.supply")}
              kind="select"
              options={supplyPolicyOptions}
            />
            <Field field="is_stockable" label={t("catalog.field.stockable")} kind="toggle" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-none pb-0">
            <CardTitle className="text-sm font-semibold">{t("catalog.logistics.packaging")}</CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            <Field field="primary_packaging_qty" label={t("catalog.field.packPrimary")} kind="int" />
            <Field field="secondary_packaging_qty" label={t("catalog.field.packSecondary")} kind="int" />
            <Field field="tertiary_packaging_qty" label={t("catalog.field.packTertiary")} kind="int" />
            <Field field="pallet_qty" label={t("catalog.field.pallet")} kind="int" />
          </CardContent>
        </Card>
      </div>

      <AttributeSection
        category="logistic"
        title={t("catalog.logistics.attrs")}
        emptyLabel={t("catalog.logistics.empty")}
      />
    </div>
  );
}
