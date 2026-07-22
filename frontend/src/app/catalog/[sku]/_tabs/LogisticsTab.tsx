"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="border-none pb-0">
            <CardTitle className="text-sm font-semibold">
              Unité, poids & approvisionnement
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            <Field
              field="base_unit"
              label="Unité de base"
              kind="select"
              options={BASE_UNIT_OPTIONS}
            />
            <Field field="uom" label="Unité réelle (Odoo)" kind="text" readOnly />
            {/* Poids unitaire : de retour en Logistique (FEEDBACK 2), sa place
                d'origine. Le round 1 l'avait déplacé en Technique par erreur. */}
            <Field field="unit_weight_kg" label="Poids unitaire" kind="number" unit="kg" />
            <Field
              field="supply_policy"
              label="Approvisionnement"
              kind="select"
              options={SUPPLY_POLICY_OPTIONS}
            />
            <Field field="is_stockable" label="Stockable" kind="toggle" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-none pb-0">
            <CardTitle className="text-sm font-semibold">Conditionnement</CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            <Field field="primary_packaging_qty" label="Qté colisage primaire" kind="int" />
            <Field field="secondary_packaging_qty" label="Qté colisage secondaire" kind="int" />
            <Field field="tertiary_packaging_qty" label="Qté colisage tertiaire" kind="int" />
            <Field field="pallet_qty" label="Qté palette" kind="int" />
          </CardContent>
        </Card>
      </div>

      <AttributeSection
        category="logistic"
        title="Attributs logistiques"
        emptyLabel="Aucun attribut logistique défini."
      />
    </div>
  );
}
