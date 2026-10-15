/**
 * Interface catalogs (stories 7.1 and 7.2). French is the source. A missing
 * English entry falls back to French for that key alone.
 * Product content (DeepL) does not go through here.
 */

import { en as adminEn, fr as adminFr } from "@/lib/i18n/catalogs/admin";
import { en as catalogEn, fr as catalogFr } from "@/lib/i18n/catalogs/catalog";
import { en as commonEn, fr as commonFr } from "@/lib/i18n/catalogs/common";
import { en as comparatorEn, fr as comparatorFr } from "@/lib/i18n/catalogs/comparator";
import { en as libraryEn, fr as libraryFr } from "@/lib/i18n/catalogs/library";
import { en as offersEn, fr as offersFr } from "@/lib/i18n/catalogs/offers";
import { en as sessionEn, fr as sessionFr } from "@/lib/i18n/catalogs/session";
import { en as settingsEn, fr as settingsFr } from "@/lib/i18n/catalogs/settings";
import { en as simulatorEn, fr as simulatorFr } from "@/lib/i18n/catalogs/simulator";
import { en as suppliersEn, fr as suppliersFr } from "@/lib/i18n/catalogs/suppliers";

export type UiLocale = "fr" | "en";

const fr = {
  ...sessionFr,
  ...commonFr,
  ...catalogFr,
  ...suppliersFr,
  ...simulatorFr,
  ...comparatorFr,
  ...offersFr,
  ...libraryFr,
  ...settingsFr,
  ...adminFr,
} as const;

export type MessageKey = keyof typeof fr;

const en: Partial<Record<MessageKey, string>> = {
  ...sessionEn,
  ...commonEn,
  ...catalogEn,
  ...suppliersEn,
  ...simulatorEn,
  ...comparatorEn,
  ...offersEn,
  ...libraryEn,
  ...settingsEn,
  ...adminEn,
};

export function translate(
  key: MessageKey,
  locale: string,
  vars?: Record<string, string | number>,
): string {
  const translated = locale === "fr" ? undefined : en[key];
  const template = translated ?? fr[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? ""));
}

export function uiDateLocale(locale: string): string {
  return locale === "en" ? "en-GB" : "fr-FR";
}

/** Display-only. Incoming documents are not parsed with this locale. */
export function formatUiNumber(
  value: number,
  locale = "fr",
  options?: Intl.NumberFormatOptions,
): string {
  return value.toLocaleString(uiDateLocale(locale), options);
}

export function formatUiDate(
  value: Date | string | number,
  locale = "fr",
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(uiDateLocale(locale), options);
}

export function formatUiDateTime(
  value: Date | string | number,
  locale = "fr",
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(uiDateLocale(locale), options);
}
