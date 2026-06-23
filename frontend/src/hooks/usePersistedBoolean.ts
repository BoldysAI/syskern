"use client";

import { useCallback, useState } from "react";

function loadBoolean(storageKey: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw === null) return fallback;
    return raw === "true";
  } catch {
    return fallback;
  }
}

/** Boolean state synced to localStorage (`"true"` / `"false"` strings). */
export function usePersistedBoolean(storageKey: string, defaultValue = false) {
  const [value, setValue] = useState(() => loadBoolean(storageKey, defaultValue));

  const setPersisted = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      setValue((prev) => {
        const resolved = typeof next === "function" ? next(prev) : next;
        try {
          window.localStorage.setItem(storageKey, String(resolved));
        } catch {
          // Ignore storage errors.
        }
        return resolved;
      });
    },
    [storageKey]
  );

  const toggle = useCallback(() => {
    setPersisted((prev) => !prev);
  }, [setPersisted]);

  return [value, setPersisted, toggle] as const;
}
