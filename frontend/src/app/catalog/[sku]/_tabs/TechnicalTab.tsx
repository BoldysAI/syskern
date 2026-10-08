"use client";

import { useUiTranslate } from "@/lib/use-ui-translate";
import { AttributeSection } from "./AttributeSection";
import { DescriptionsEditor } from "./DescriptionsEditor";

export function TechnicalTab() {
  const t = useUiTranslate();
  return (
    <div className="flex flex-col gap-6">
      {/* FEEDBACK 2 : le poids unitaire est reparti en Logistique et l'indexation
          cuivre en Commercial (portée par la relation produit-fournisseur).
          Annule le regroupement fait au round 1. */}
      <AttributeSection
        category="technical"
        title={t("catalog.technical.attrs")}
        emptyLabel={t("catalog.technical.empty")}
      />
      <DescriptionsEditor which="technical" title={t("catalog.bulk.technical")} />
    </div>
  );
}
