"use client";

import { useCallback, useState } from "react";

const STORAGE_KEY = "syskern:catalog-col-widths:v1";

type Widths = Record<string, number>;

function loadWidths(defaults: Widths): Widths {
  if (typeof window === "undefined") return defaults;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    return { ...defaults, ...(JSON.parse(raw) as Widths) };
  } catch {
    return defaults;
  }
}

function persistWidths(widths: Widths): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(widths));
  } catch {
    // Ignore quota / private-mode errors.
  }
}

/** Resizable column widths persisted to localStorage (CDC §4.3). */
export function useColumnWidths(defaults: Widths) {
  const [widths, setWidths] = useState<Widths>(() => loadWidths(defaults));
  const [resizingKey, setResizingKey] = useState<string | null>(null);

  const startResize = useCallback(
    (key: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startW = widths[key] ?? defaults[key] ?? 120;
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
          persistWidths(next);
          return next;
        });
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [widths, defaults]
  );

  return { widths, startResize, resizingKey };
}
