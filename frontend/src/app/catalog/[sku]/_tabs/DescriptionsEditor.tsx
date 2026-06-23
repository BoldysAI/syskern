"use client";

import { Languages } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEdit, type DescriptionKind } from "./edit-context";

const LANGS = ["fr", "en", "es"] as const;
const LANG_LABELS: Record<string, string> = {
  fr: "Français",
  en: "Anglais",
  es: "Espagnol",
};

const inputCls =
  "w-full px-3 py-2 text-sm border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#E07200]/30 focus:border-[#E07200]";

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
    <div className="bg-white border border-[#E2E8F0] rounded-xl p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-700 mb-4">{title}</h3>
      <div className="flex flex-col gap-4">
        {LANGS.map((lang) => {
          const text = descValue(which, lang);
          const showTranslate = !!onTranslate && lang !== "fr" && !text;
          return (
            <div key={lang}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  {LANG_LABELS[lang]}
                  {lang === "fr" && <span className="text-red-400 ml-0.5">*</span>}
                </span>
                {showTranslate && (
                  <button
                    type="button"
                    onClick={() => onTranslate?.(lang as "en" | "es")}
                    disabled={!!translating}
                    className="flex items-center gap-1.5 text-xs font-medium text-[#E07200] hover:text-[#C56400] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Languages size={13} className={cn(translating === lang && "animate-pulse")} />
                    {translating === lang ? "Traduction…" : "Traduire avec DeepL"}
                  </button>
                )}
              </div>
              {mode === "edit" ? (
                <textarea
                  value={text}
                  rows={3}
                  onChange={(e) => setDesc(which, lang, e.target.value)}
                  className={cn(inputCls, "resize-y")}
                />
              ) : text ? (
                <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">{text}</p>
              ) : (
                <p className="text-sm text-slate-400 italic">
                  Aucune description en {LANG_LABELS[lang].toLowerCase()}.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
