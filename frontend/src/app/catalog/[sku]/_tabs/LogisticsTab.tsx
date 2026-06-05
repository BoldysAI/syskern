"use client";

import { Field } from "./Field";
import { AttributeSection } from "./AttributeSection";

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

export function LogisticsTab() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-[#E2E8F0] rounded-xl p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Poids & unité</h3>
          <Field field="unit_weight_kg" label="Poids unitaire" kind="number" unit="kg" />
          <Field field="base_unit" label="Unité de base" kind="select" options={BASE_UNIT_OPTIONS} />
          <Field field="supply_policy" label="Approvisionnement" kind="select" options={SUPPLY_POLICY_OPTIONS} />
          <Field field="is_stockable" label="Stockable" kind="toggle" />
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-xl p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Conditionnement</h3>
          <Field field="primary_packaging_qty" label="Qté colisage primaire" kind="int" />
          <Field field="secondary_packaging_qty" label="Qté colisage secondaire" kind="int" />
          <Field field="tertiary_packaging_qty" label="Qté colisage tertiaire" kind="int" />
          <Field field="pallet_qty" label="Qté palette" kind="int" />
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-xl p-5 shadow-sm lg:col-span-2">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Indexation cuivre</h3>
          <Field field="is_copper_indexed" label="Indexé cuivre" kind="toggle" />
          <Field field="copper_weight_kg_per_unit" label="Poids cuivre / unité" kind="number" unit="kg" />
        </div>
      </div>

      <AttributeSection
        category="logistic"
        title="Attributs logistiques"
        emptyLabel="Aucun attribut logistique défini."
      />
    </div>
  );
}
