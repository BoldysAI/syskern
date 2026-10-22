import { translate, uiDateLocale } from "@/lib/i18n";

export function formatRelative(dateStr: string, locale = "fr"): string {
  const date = new Date(dateStr);
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return translate("dashboard.justNow", locale);
  if (diffMin < 60) return translate("dashboard.minutesAgo", locale, { count: diffMin });
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return translate("dashboard.hoursAgo", locale, { count: diffH });
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return translate("dashboard.daysAgo", locale, { count: diffD });
  return date.toLocaleDateString(uiDateLocale(locale), { day: "numeric", month: "short" });
}
