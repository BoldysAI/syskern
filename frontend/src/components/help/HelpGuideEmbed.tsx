"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { useUiTranslate } from "@/lib/use-ui-translate";

interface HelpGuideEmbedProps {
  className?: string;
  /** Accessible title for the iframe. */
  title?: string;
  src: string;
}

/** Full-bleed Notion guide embed with a soft loading state. */
export function HelpGuideEmbed({
  className,
  title,
  src,
}: HelpGuideEmbedProps) {
  const t = useUiTranslate();
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const loaded = loadedSrc === src;

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
        src={src}
        title={title ?? t("help.embedTitle")}
        className={cn(
          "h-full w-full border-0 transition-opacity duration-300",
          loaded ? "opacity-100" : "opacity-0",
        )}
        allowFullScreen
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
        onLoad={() => setLoadedSrc(src)}
      />
    </div>
  );
}
