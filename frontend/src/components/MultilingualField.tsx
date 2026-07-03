"use client";

import { useState } from "react";
import { Translate } from "@phosphor-icons/react";
import { translateText } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export type Lang = "fr" | "en" | "es";
export type MultilingualValue = Partial<Record<Lang, string>>;

const LANGS: Lang[] = ["fr", "en", "es"];
const LANG_LABELS: Record<Lang, string> = {
  fr: "Français",
  en: "Anglais",
  es: "Espagnol",
};
const LANG_SHORT: Record<Lang, string> = { fr: "FR", en: "EN", es: "ES" };

interface MultilingualFieldProps {
  value: MultilingualValue;
  onChange?: (value: MultilingualValue) => void;
  mode?: "edit" | "read";
  kind?: "input" | "textarea";
  /** Field label rendered above the tabs. */
  label?: string;
  /** Mark the source language (FR) as required with an asterisk. */
  requiredSource?: boolean;
  rows?: number;
  placeholder?: string;
  /** Source language for the default « Traduire » action (default FR). */
  sourceLang?: Lang;
  /** Extra source languages per target tab (e.g. `{ fr: ["en"] }` → translate FR from EN). */
  extraTranslateSources?: Partial<Record<Lang, Lang[]>>;
}

function extractApiError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  // apiFetch throws `API <status>: <body>` — try to surface the FR `detail`.
  const jsonStart = msg.indexOf("{");
  if (jsonStart !== -1) {
    try {
      const parsed = JSON.parse(msg.slice(jsonStart)) as { detail?: string };
      if (parsed.detail) return parsed.detail;
    } catch {
      /* fall through */
    }
  }
  if (msg.includes("402")) return "Quota de traduction dépassé.";
  if (msg.includes("503")) return "Service de traduction temporairement indisponible.";
  return "La traduction a échoué. Réessaie ou saisis le texte manuellement.";
}

export function MultilingualField({
  value,
  onChange,
  mode = "edit",
  kind = "textarea",
  label,
  requiredSource = false,
  rows = 3,
  placeholder,
  sourceLang = "fr",
  extraTranslateSources,
}: MultilingualFieldProps) {
  const [active, setActive] = useState<Lang>("fr");
  const [translating, setTranslating] = useState<{ target: Lang; source: Lang } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setLang = (lang: Lang, text: string) => {
    onChange?.({ ...value, [lang]: text });
  };

  const translateSourcesFor = (targetLang: Lang): Lang[] => {
    const sources: Lang[] = [];
    if (
      targetLang !== sourceLang &&
      (value[sourceLang] ?? "").trim() &&
      !sources.includes(sourceLang)
    ) {
      sources.push(sourceLang);
    }
    for (const alt of extraTranslateSources?.[targetLang] ?? []) {
      if (alt !== targetLang && (value[alt] ?? "").trim() && !sources.includes(alt)) {
        sources.push(alt);
      }
    }
    return sources;
  };

  const handleTranslate = async (targetLang: Lang, fromLang: Lang) => {
    const source = (value[fromLang] ?? "").trim();
    if (!source || targetLang === fromLang) return;
    setTranslating({ target: targetLang, source: fromLang });
    setError(null);
    try {
      const res = await translateText(source, targetLang, fromLang);
      setLang(targetLang, res.translated_text);
    } catch (err) {
      setError(extractApiError(err));
    } finally {
      setTranslating(null);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {label && (
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
      )}
      <Tabs value={active} onValueChange={(v) => setActive(v as Lang)}>
        <TabsList className="w-full">
          {LANGS.map((lang) => {
            const filled = Boolean((value[lang] ?? "").trim());
            return (
              <TabsTrigger key={lang} value={lang} className="gap-1.5">
                <span
                  aria-hidden
                  className={cn(
                    "size-1.5 rounded-full",
                    filled ? "bg-emerald-500" : "bg-amber-500",
                  )}
                />
                {LANG_SHORT[lang]}
                {lang === sourceLang && requiredSource && (
                  <span className="text-destructive">*</span>
                )}
                <span className="sr-only">
                  {filled ? "rempli" : "à compléter"}
                </span>
              </TabsTrigger>
            );
          })}
        </TabsList>

        {LANGS.map((lang) => {
          const text = value[lang] ?? "";
          const translateSources = mode === "edit" ? translateSourcesFor(lang) : [];
          return (
            <TabsContent key={lang} value={lang} className="mt-2 flex flex-col gap-1.5">
              {translateSources.length > 0 && (
                <div className="flex flex-wrap justify-end gap-2">
                  {translateSources.map((fromLang) => {
                    const isActive =
                      translating?.target === lang && translating.source === fromLang;
                    return (
                      <button
                        key={fromLang}
                        type="button"
                        onClick={() => handleTranslate(lang, fromLang)}
                        disabled={translating !== null}
                        className="flex items-center gap-1.5 text-xs font-medium text-primary transition-colors hover:text-primary/80 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Translate
                          size={14}
                          weight="duotone"
                          className={cn(isActive && "animate-pulse")}
                        />
                        {isActive
                          ? "Traduction…"
                          : `Traduire depuis ${LANG_SHORT[fromLang]}`}
                      </button>
                    );
                  })}
                </div>
              )}
              {mode === "read" ? (
                text ? (
                  <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">
                    {text}
                  </p>
                ) : (
                  <p className="text-sm italic text-muted-foreground">
                    Aucun contenu en {LANG_LABELS[lang].toLowerCase()}.
                  </p>
                )
              ) : kind === "input" ? (
                <Input
                  value={text}
                  placeholder={placeholder}
                  onChange={(e) => setLang(lang, e.target.value)}
                />
              ) : (
                <Textarea
                  value={text}
                  rows={rows}
                  placeholder={placeholder}
                  onChange={(e) => setLang(lang, e.target.value)}
                  className="resize-y"
                />
              )}
            </TabsContent>
          );
        })}
      </Tabs>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
