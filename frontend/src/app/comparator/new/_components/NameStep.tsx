"use client";

import { useUiTranslate } from "@/lib/use-ui-translate";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ComparisonWizardDraft } from "./wizard-draft";

interface Props {
  draft: ComparisonWizardDraft;
  onChange: (patch: Partial<ComparisonWizardDraft>) => void;
}

export function NameStep({ draft, onChange }: Props) {
  const t = useUiTranslate();
  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t("comparator.new.nameTitle")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("comparator.new.nameHint")}</p>
      </div>

      <div>
        <label htmlFor="comparison-label" className="mb-1.5 block text-xs font-semibold text-muted-foreground">
          {t("comparator.new.nameLabel")}
        </label>
        <Input
          id="comparison-label"
          value={draft.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder={t("comparator.new.namePlaceholder")}
          autoComplete="off"
          autoFocus
        />
      </div>

      <div>
        <label htmlFor="comparison-note" className="mb-1.5 block text-xs font-semibold text-muted-foreground">
          {t("comparator.new.noteLabel")}
        </label>
        <Textarea
          id="comparison-note"
          value={draft.note}
          onChange={(e) => onChange({ note: e.target.value })}
          rows={3}
          placeholder={t("comparator.new.notePlaceholder")}
        />
      </div>
    </div>
  );
}
