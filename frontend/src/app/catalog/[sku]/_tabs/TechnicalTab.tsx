"use client";

import { AttributeSection } from "./AttributeSection";
import { DescriptionsEditor } from "./DescriptionsEditor";

export function TechnicalTab() {
  return (
    <div className="flex flex-col gap-6">
      <AttributeSection
        category="technical"
        title="Attributs techniques"
        emptyLabel="Aucun attribut technique défini pour ce produit."
      />
      <DescriptionsEditor which="technical" title="Descriptions techniques" />
    </div>
  );
}
