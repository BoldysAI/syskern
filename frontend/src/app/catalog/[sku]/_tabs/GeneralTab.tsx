"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "./Field";
import { AttributeSection } from "./AttributeSection";
import { DescriptionsEditor } from "./DescriptionsEditor";

export function GeneralTab() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="border-none pb-0">
            <CardTitle className="text-sm font-semibold">Informations générales</CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            <Field field="sku_code" label="SKU" readOnly />
            {/* Code article juste sous le SKU — niveau de référence intermédiaire
                demandé par le client (FEEDBACK 2). */}
            <Field field="item_code" label="Code article" />
            <Field field="name" label="Nom" />
            <Field field="brand" label="Marque" />
            <Field field="universe" label="Univers" />
            <Field field="family" label="Famille" />
            <Field field="range" label="Gamme" />
            <Field field="sub_range" label="Sous-gamme" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-none pb-0">
            <CardTitle className="text-sm font-semibold">Identifiants</CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            <Field field="gtin" label="GTIN" />
            <Field field="hs_code" label="Code HS" />
            <Field field="dop_number" label="N° DOP" />
            <Field field="parent_reference" label="Référence parent" />
            {/* « Code usine » retiré ici (FEEDBACK 2) : l'information est portée par
                la relation produit-fournisseur, pas par le produit. Voir onglet
                Commercial / module Fournisseurs. */}
          </CardContent>
        </Card>
      </div>

      <DescriptionsEditor which="marketing" title="Descriptions multilingues" />

      <AttributeSection
        category="structural"
        title="Attributs structurels"
        emptyLabel="Aucun attribut structurel défini."
      />
    </div>
  );
}
