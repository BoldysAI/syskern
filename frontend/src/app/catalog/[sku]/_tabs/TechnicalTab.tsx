"use client";

import { AttributeSection } from "./AttributeSection";
import { DescriptionsEditor } from "./DescriptionsEditor";

export function TechnicalTab() {
  return (
    <div className="flex flex-col gap-6">
      {/* FEEDBACK 2 : le poids unitaire est reparti en Logistique et l'indexation
          cuivre en Commercial (portée par la relation produit-fournisseur).
          Annule le regroupement fait au round 1. */}
      <AttributeSection
        category="technical"
        title="Attributs techniques"
        emptyLabel="Aucun attribut technique défini pour ce produit."
      />
      <DescriptionsEditor which="technical" title="Descriptions techniques" />
    </div>
  );
}
