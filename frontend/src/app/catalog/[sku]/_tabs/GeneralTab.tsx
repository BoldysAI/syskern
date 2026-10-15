"use client";

import { useUiTranslate } from "@/lib/use-ui-translate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "./Field";
import { AttributeSection } from "./AttributeSection";
import { DescriptionsEditor } from "./DescriptionsEditor";

export function GeneralTab() {
  const t = useUiTranslate();
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="border-none pb-0">
            <CardTitle className="text-sm font-semibold">{t("catalog.general.info")}</CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            <Field field="sku_code" label={t("catalog.column.sku")} readOnly />
            {/* Code article juste sous le SKU — niveau de référence intermédiaire
                demandé par le client (FEEDBACK 2). */}
            <Field field="item_code" label={t("catalog.field.itemCode")} />
            <Field field="name" label={t("catalog.field.name")} />
            <Field field="brand" label={t("catalog.column.brand")} />
            <Field field="universe" label={t("catalog.column.universe")} />
            <Field field="family" label={t("catalog.column.family")} />
            <Field field="range" label={t("catalog.column.range")} />
            <Field field="sub_range" label={t("catalog.column.subRange")} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-none pb-0">
            <CardTitle className="text-sm font-semibold">{t("catalog.field.identifiers")}</CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            <Field field="gtin" label={t("catalog.field.gtin")} />
            <Field field="hs_code" label={t("catalog.field.hsCode")} />
            <Field field="dop_number" label={t("catalog.field.dop")} />
            <Field field="parent_reference" label={t("catalog.field.parentRef")} />
            {/* « Code usine » retiré ici (FEEDBACK 2) : l'information est portée par
                la relation produit-fournisseur, pas par le produit. Voir onglet
                Commercial / module Fournisseurs. */}
          </CardContent>
        </Card>
      </div>

      <DescriptionsEditor which="marketing" title={t("catalog.general.descriptions")} />

      <AttributeSection
        category="structural"
        title={t("catalog.general.structuralAttrs")}
        emptyLabel={t("catalog.general.noStructural")}
      />
    </div>
  );
}
