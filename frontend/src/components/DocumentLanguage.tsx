"use client";

import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { setApiLocale } from "@/lib/api";
import { translate, uiDateLocale, type MessageKey } from "@/lib/i18n";

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

const VALIDITY_KEYS: Array<[keyof ValidityState, MessageKey]> = [
  ["valueMissing", "common.validity.required"],
  ["typeMismatch", "common.validity.type"],
  ["tooShort", "common.validity.tooShort"],
  ["tooLong", "common.validity.tooLong"],
  ["rangeUnderflow", "common.validity.range"],
  ["rangeOverflow", "common.validity.range"],
  ["patternMismatch", "common.validity.pattern"],
  ["stepMismatch", "common.validity.step"],
];

function isField(target: EventTarget | null): target is Field {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

function validityMessage(field: Field, locale: string): string {
  for (const [flag, key] of VALIDITY_KEYS) {
    if (field.validity[flag]) return translate(key, locale);
  }
  return "";
}

/**
 * Date fields follow the account language via `<html lang>`.
 * Native bubbles follow the browser language, so they are replaced here.
 */
export function DocumentLanguage() {
  const { displayLanguage } = useAuth();

  useEffect(() => {
    document.documentElement.lang = uiDateLocale(displayLanguage);
    setApiLocale(displayLanguage);
  }, [displayLanguage]);

  useEffect(() => {
    const onInvalid = (event: Event) => {
      if (!isField(event.target)) return;
      const message = validityMessage(event.target, displayLanguage);
      if (!message || event.target.validationMessage === message) return;
      event.preventDefault();
      event.target.setCustomValidity(message);
      event.target.reportValidity();
    };
    const clear = (event: Event) => {
      if (isField(event.target)) event.target.setCustomValidity("");
    };
    document.addEventListener("invalid", onInvalid, true);
    document.addEventListener("input", clear, true);
    document.addEventListener("change", clear, true);
    return () => {
      document.removeEventListener("invalid", onInvalid, true);
      document.removeEventListener("input", clear, true);
      document.removeEventListener("change", clear, true);
    };
  }, [displayLanguage]);

  return null;
}
