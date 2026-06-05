"use client";

import type { AttributeCategory } from "@/lib/api";
import { AttributeRenderer } from "@/components/AttributeRenderer";
import { useEdit } from "./edit-context";

interface AttributeSectionProps {
  category: AttributeCategory;
  title: string;
  /** Shown when the category has no attribute defined yet. */
  emptyLabel?: string;
}

export function AttributeSection({ category, title, emptyLabel }: AttributeSectionProps) {
  const { attrsByCategory, attrValue, setAttr, mode, lang } = useEdit();
  const attrs = attrsByCategory(category);

  if (attrs.length === 0) {
    return (
      <div className="bg-white border border-[#E2E8F0] rounded-xl p-8 text-center text-sm text-slate-400 shadow-sm">
        {emptyLabel ?? "Aucun attribut défini pour cette catégorie."}
      </div>
    );
  }

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-xl p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-700 mb-3">{title}</h3>
      {attrs.map((attr) => (
        <AttributeRenderer
          key={attr.id}
          attribute={attr}
          value={attrValue(attr.id)}
          mode={mode}
          lang={lang}
          onChange={(v, valid) => setAttr(attr.id, v, valid)}
        />
      ))}
    </div>
  );
}
