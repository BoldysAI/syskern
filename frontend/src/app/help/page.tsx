"use client";

import { useState } from "react";
import { ArrowSquareOut } from "@phosphor-icons/react";
import { useAuth } from "@/contexts/AuthContext";
import { HelpGuideEmbed } from "@/components/help/HelpGuideEmbed";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { helpNotionUrls } from "@/lib/help";
import type { UiLocale } from "@/lib/i18n";
import { useUiTranslate } from "@/lib/use-ui-translate";
import { cn } from "@/lib/utils";

export default function HelpPage() {
  const t = useUiTranslate();
  const { displayLanguage } = useAuth();
  const [guideLocale, setGuideLocale] = useState<UiLocale | null>(null);
  const locale: UiLocale = guideLocale ?? (displayLanguage === "en" ? "en" : "fr");
  const urls = helpNotionUrls(locale);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border bg-card/60 px-6 py-4 backdrop-blur-sm">
        <PageHeader
          variant="dense"
          className="mb-0"
          title={t("help.title")}
          description={t("help.description")}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-lg border border-border p-0.5">
                <Button
                  type="button"
                  size="sm"
                  variant={locale === "fr" ? "default" : "ghost"}
                  className={cn("h-7 px-2.5", locale !== "fr" && "text-muted-foreground")}
                  onClick={() => setGuideLocale("fr")}
                >
                  {t("help.versionFr")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={locale === "en" ? "default" : "ghost"}
                  className={cn("h-7 px-2.5", locale !== "en" && "text-muted-foreground")}
                  onClick={() => setGuideLocale("en")}
                >
                  {t("help.versionEn")}
                </Button>
              </div>
              {urls ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  nativeButton={false}
                  render={
                    <a href={urls.public} target="_blank" rel="noopener noreferrer" />
                  }
                >
                  {t("help.openNotion")}
                  <ArrowSquareOut size={14} />
                </Button>
              ) : null}
            </div>
          }
        />
      </div>

      <div className="min-h-0 flex-1 p-4 sm:p-6">
        {urls ? (
          <HelpGuideEmbed
            src={urls.embed}
            className="h-full min-h-[28rem] rounded-xl border border-border shadow-[var(--shadow-soft)]"
          />
        ) : (
          <div className="flex h-full min-h-[28rem] flex-col items-start justify-center gap-4 rounded-xl border border-border bg-card p-8">
            <p className="max-w-lg text-sm text-muted-foreground">{t("help.englishMissing")}</p>
            <Button type="button" variant="outline" onClick={() => setGuideLocale("fr")}>
              {t("help.versionFr")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
