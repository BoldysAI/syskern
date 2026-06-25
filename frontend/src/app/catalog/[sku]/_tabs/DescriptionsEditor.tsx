"use client";

import { Translate } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useEdit, type DescriptionKind } from "./edit-context";

const LANGS = ["fr", "en", "es"] as const;
const LANG_LABELS: Record<string, string> = {
  fr: "Français",
  en: "Anglais",
  es: "Espagnol",
};

interface DescriptionsEditorProps {
  which: DescriptionKind;
  title: string;
  /** When set, shows a DeepL translate button for empty EN/ES. */
  onTranslate?: (lang: "en" | "es") => void;
  translating?: "en" | "es" | null;
}

export function DescriptionsEditor({
  which,
  title,
  onTranslate,
  translating,
}: DescriptionsEditorProps) {
  const { mode, descValue, setDesc } = useEdit();

  return (
    <Card>
      <CardHeader className="border-none pb-0">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-3">
        {LANGS.map((lang) => {
          const text = descValue(which, lang);
          const showTranslate = !!onTranslate && lang !== "fr" && !text;
          return (
            <div key={lang}>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {LANG_LABELS[lang]}
                  {lang === "fr" && <span className="ml-0.5 text-destructive">*</span>}
                </span>
                {showTranslate && (
                  <button
                    type="button"
                    onClick={() => onTranslate?.(lang as "en" | "es")}
                    disabled={!!translating}
                    className="flex items-center gap-1.5 text-xs font-medium text-warm transition-colors hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Translate
                      size={13}
                      weight="duotone"
                      className={cn(translating === lang && "animate-pulse")}
                    />
                    {translating === lang ? "Traduction…" : "Traduire avec DeepL"}
                  </button>
                )}
              </div>
              {mode === "edit" ? (
                <Textarea
                  value={text}
                  rows={3}
                  onChange={(e) => setDesc(which, lang, e.target.value)}
                  className="resize-y"
                />
              ) : text ? (
                <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">{text}</p>
              ) : (
                <p className="text-sm italic text-muted-foreground">
                  Aucune description en {LANG_LABELS[lang].toLowerCase()}.
                </p>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
