"use client";

import { AttributeSection } from "./AttributeSection";

export function MarketingTab() {
  return (
    <div className="flex flex-col gap-6">
      <AttributeSection
        category="marketing"
        title="Attributs marketing & contenus enrichis"
        emptyLabel="Aucun attribut marketing défini pour ce produit."
      />
    </div>
  );
}
