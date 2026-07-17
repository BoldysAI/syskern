"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AttributeSection } from "./AttributeSection";
import { DescriptionsEditor } from "./DescriptionsEditor";
import { Field } from "./Field";

export function TechnicalTab() {
  return (
    <div className="flex flex-col gap-6">
      {/* Poids unitaire + indexation cuivre — déplacés de Logistique vers Technique
          à la demande client (démo FEEDBACK 1). Dérive assumée au CDC §4.1.2. */}
      <Card>
        <CardHeader className="border-none pb-0">
          <CardTitle className="text-sm font-semibold">Poids & indexation cuivre</CardTitle>
        </CardHeader>
        <CardContent className="pt-3">
          <Field field="unit_weight_kg" label="Poids unitaire" kind="number" unit="kg" />
          <Field field="is_copper_indexed" label="Indexé cuivre" kind="toggle" />
          <Field
            field="copper_weight_kg_per_unit"
            label="Poids cuivre / unité"
            kind="number"
            unit="kg"
          />
        </CardContent>
      </Card>

      <AttributeSection
        category="technical"
        title="Attributs techniques"
        emptyLabel="Aucun attribut technique défini pour ce produit."
      />
      <DescriptionsEditor which="technical" title="Descriptions techniques" />
    </div>
  );
}
