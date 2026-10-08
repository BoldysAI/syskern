"use client";

import { useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { translate, type MessageKey } from "@/lib/i18n";

export function useUiTranslate() {
  const { displayLanguage } = useAuth();
  return useCallback(
    (key: MessageKey, vars?: Record<string, string | number>) =>
      translate(key, displayLanguage, vars),
    [displayLanguage],
  );
}
