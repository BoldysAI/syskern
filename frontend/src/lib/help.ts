/** User-facing help / documentation (Notion embed). */

const NOTION_SITE = "https://vaulted-gateway-65b.notion.site";

/** Published Notion page ids. The help screen embeds the page for the chosen language. */
export const HELP_NOTION_PAGE_IDS: Record<"fr" | "en", string> = {
  fr: "3a774dd6427b814380a0d99e1c369e64",
  en: "40274dd6427b81f88972d40ac2ef9b00",
};

export function helpNotionUrls(
  locale: "fr" | "en",
): { embed: string; public: string } | null {
  const id = HELP_NOTION_PAGE_IDS[locale];
  if (!id) return null;
  return {
    embed: `${NOTION_SITE}/ebd/${id}`,
    public: `${NOTION_SITE}/${id}`,
  };
}

/** Public Notion site embed (guide utilisateur Syskern, français). */
export const HELP_NOTION_EMBED_URL = helpNotionUrls("fr")!.embed;

/** Same French guide opened outside the app (new tab). */
export const HELP_NOTION_PUBLIC_URL = helpNotionUrls("fr")!.public;
