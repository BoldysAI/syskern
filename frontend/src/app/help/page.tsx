"use client";

import { ArrowSquareOut } from "@phosphor-icons/react";
import { HelpGuideEmbed } from "@/components/help/HelpGuideEmbed";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { HELP_NOTION_PUBLIC_URL } from "@/lib/help";

export default function HelpPage() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border bg-card/60 px-6 py-4 backdrop-blur-sm">
        <PageHeader
          variant="dense"
          className="mb-0"
          title="Guide utilisateur"
          description="Documentation et tutoriels Syskern — catalogue, simulations, comparaisons et offres."
          actions={
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              nativeButton={false}
              render={
                <a
                  href={HELP_NOTION_PUBLIC_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
            >
              Ouvrir dans Notion
              <ArrowSquareOut size={14} />
            </Button>
          }
        />
      </div>

      <div className="min-h-0 flex-1 p-4 sm:p-6">
        <HelpGuideEmbed className="h-full min-h-[28rem] rounded-xl border border-border shadow-[var(--shadow-soft)]" />
      </div>
    </div>
  );
}
