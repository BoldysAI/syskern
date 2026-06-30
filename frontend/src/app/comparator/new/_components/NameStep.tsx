"use client";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ComparisonWizardDraft } from "./wizard-draft";

interface Props {
  draft: ComparisonWizardDraft;
  onChange: (patch: Partial<ComparisonWizardDraft>) => void;
}

export function NameStep({ draft, onChange }: Props) {
  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Nom de la comparaison</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Donnez un nom explicite pour retrouver cette comparaison dans la liste.
        </p>
      </div>

      <div>
        <label htmlFor="comparison-label" className="mb-1.5 block text-xs font-semibold text-muted-foreground">
          Nom *
        </label>
        <Input
          id="comparison-label"
          value={draft.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="Ex. Tarif Q2 vs Q3 — gamme cuivre"
          autoComplete="off"
          autoFocus
        />
      </div>

      <div>
        <label htmlFor="comparison-note" className="mb-1.5 block text-xs font-semibold text-muted-foreground">
          Note (optionnel)
        </label>
        <Textarea
          id="comparison-note"
          value={draft.note}
          onChange={(e) => onChange({ note: e.target.value })}
          rows={3}
          placeholder="Contexte, hypothèses, objectif de la comparaison…"
        />
      </div>
    </div>
  );
}
