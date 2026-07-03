"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MultilingualField, type Lang, type MultilingualValue } from "@/components/MultilingualField";
import { useEdit, type DescriptionKind } from "./edit-context";

const LANGS: Lang[] = ["fr", "en", "es"];

interface DescriptionsEditorProps {
  which: DescriptionKind;
  title: string;
}

export function DescriptionsEditor({ which, title }: DescriptionsEditorProps) {
  const { mode, descValue, setDesc } = useEdit();

  const value: MultilingualValue = {
    fr: descValue(which, "fr"),
    en: descValue(which, "en"),
    es: descValue(which, "es"),
  };

  const handleChange = (next: MultilingualValue) => {
    for (const lang of LANGS) {
      const nextText = next[lang] ?? "";
      if (nextText !== (value[lang] ?? "")) setDesc(which, lang, nextText);
    }
  };

  return (
    <Card>
      <CardHeader className="border-none pb-0">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-3">
        <MultilingualField
          value={value}
          onChange={handleChange}
          mode={mode}
          kind="textarea"
          requiredSource
          rows={4}
          extraTranslateSources={{ fr: ["en"] }}
        />
      </CardContent>
    </Card>
  );
}
