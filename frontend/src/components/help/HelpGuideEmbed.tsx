"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { useUiTranslate } from "@/lib/use-ui-translate";
import { HELP_NOTION_EMBED_URL } from "@/lib/help";

interface HelpGuideEmbedProps {
  className?: string;
  /** Accessible title for the iframe. */
  title?: string;
}

/** Full-bleed Notion guide embed with a soft loading state. */
export function HelpGuideEmbed({
  className,
  title,
}: HelpGuideEmbedProps) {
  const t = useUiTranslate();
  const [loaded, setLoaded] = useState(false);

  return (
    <div className={cn("relative overflow-hidden bg-card", className)}>
      {!loaded && (
        <div
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-muted/40"
          aria-hidden
        >
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">{t("help.loading")}</p>
        </div>
      )}
      <iframe
        src={HELP_NOTION_EMBED_URL}
        title={title ?? t("help.embedTitle")}
        className={cn(
          "h-full w-full border-0 transition-opacity duration-300",
          loaded ? "opacity-100" : "opacity-0",
        )}
        allowFullScreen
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
        onLoad={() => setLoaded(true)}
      />
    </div>
  );
}
