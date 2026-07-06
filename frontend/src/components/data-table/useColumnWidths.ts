"use client";

import { useCallback, useEffect, useState } from "react";

type Widths = Record<string, number>;

function loadWidths(storageKey: string, defaults: Widths): Widths {
  if (typeof window === "undefined") return defaults;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return defaults;
    return { ...defaults, ...(JSON.parse(raw) as Widths) };
  } catch {
    return defaults;
  }
}

function persistWidths(storageKey: string, widths: Widths): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(widths));
  } catch {
    // Ignore quota / private-mode errors.
  }
}

/** Resizable column widths persisted to localStorage. */
export function useColumnWidths(defaults: Widths, storageKey: string) {
  const [widths, setWidths] = useState<Widths>(() => loadWidths(storageKey, defaults));
  const [resizingKey, setResizingKey] = useState<string | null>(null);

  // Assign default widths when new columns appear (e.g. dynamic attribute columns).
  useEffect(() => {
    setWidths((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [key, width] of Object.entries(defaults)) {
        if (next[key] === undefined) {
          next[key] = width;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [defaults]);

  const resolveWidth = useCallback(
    (key: string, fallback = 120) => widths[key] ?? defaults[key] ?? fallback,
    [widths, defaults],
  );

  const startResize = useCallback(
    (key: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startW = resolveWidth(key);
      let latest = startW;

      setResizingKey(key);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (ev: MouseEvent) => {
        latest = Math.max(60, Math.min(600, startW + ev.clientX - startX));
        setWidths((prev) => ({ ...prev, [key]: latest }));
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        setResizingKey(null);
        setWidths((prev) => {
          const next = { ...prev, [key]: latest };
          persistWidths(storageKey, next);
          return next;
        });
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [resolveWidth, storageKey],
  );

  return { widths, resolveWidth, startResize, resizingKey };
}
