"use client";

import type { AttributeCategory } from "@/lib/api";
import { AttributeRenderer } from "@/components/AttributeRenderer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          {emptyLabel ?? "Aucun attribut défini pour cette catégorie."}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="border-none pb-0">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-3">
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
      </CardContent>
    </Card>
  );
}
