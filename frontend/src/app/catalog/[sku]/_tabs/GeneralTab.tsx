"use client";

import { Field } from "./Field";
import { AttributeSection } from "./AttributeSection";
import { DescriptionsEditor } from "./DescriptionsEditor";

interface GeneralTabProps {
  onTranslate: (lang: "en" | "es") => void;
  translating: "en" | "es" | null;
}

export function GeneralTab({ onTranslate, translating }: GeneralTabProps) {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-[#E2E8F0] rounded-xl p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Informations générales</h3>
          <Field field="sku_code" label="SKU" readOnly />
          <Field field="name" label="Nom" />
          <Field field="brand" label="Marque" />
          <Field field="universe" label="Univers" />
          <Field field="family" label="Famille" />
          <Field field="range" label="Gamme" />
          <Field field="sub_range" label="Sous-gamme" />
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-xl p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Identifiants</h3>
          <Field field="gtin" label="GTIN" />
          <Field field="hs_code" label="Code HS" />
          <Field field="dop_number" label="N° DOP" />
          <Field field="item_code" label="Code article" />
          <Field field="parent_reference" label="Référence parent" />
          <Field field="factory_code" label="Code usine" />
        </div>
      </div>

      <DescriptionsEditor
        which="marketing"
        title="Descriptions multilingues"
        onTranslate={onTranslate}
        translating={translating}
      />

      <AttributeSection
        category="structural"
        title="Attributs structurels"
        emptyLabel="Aucun attribut structurel défini."
      />
    </div>
  );
}
