"use client";

import { AttributeSection } from "./AttributeSection";
import { DescriptionsEditor } from "./DescriptionsEditor";

interface TechnicalTabProps {
  onTranslate: (lang: "en" | "es") => void;
  translating: "en" | "es" | null;
}

export function TechnicalTab({ onTranslate, translating }: TechnicalTabProps) {
  return (
    <div className="flex flex-col gap-6">
      <AttributeSection
        category="technical"
        title="Attributs techniques"
        emptyLabel="Aucun attribut technique défini pour ce produit."
      />
      <DescriptionsEditor
        which="technical"
        title="Descriptions techniques"
        onTranslate={onTranslate}
        translating={translating}
      />
    </div>
  );
}
