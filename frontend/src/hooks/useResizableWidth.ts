"use client";

import { useCallback, useState } from "react";

function loadWidth(storageKey: string | undefined, fallback: number): number {
  if (!storageKey || typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return fallback;
    const parsed = Number(JSON.parse(raw));
    return Number.isFinite(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function persistWidth(storageKey: string | undefined, width: number): void {
  if (!storageKey) return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(width));
  } catch {
    // Ignore quota / private-mode errors.
  }
}

interface Options {
  min: number;
  max: number;
  storageKey?: string;
}

/** Drag-to-resize a panel width (persisted to localStorage when `storageKey` is set). */
export function useResizableWidth(defaultWidth: number, { min, max, storageKey }: Options) {
  const [width, setWidth] = useState(() => loadWidth(storageKey, defaultWidth));
  const [isResizing, setIsResizing] = useState(false);

  const startResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startW = width;
      let latest = startW;

      setIsResizing(true);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (ev: MouseEvent) => {
        latest = Math.max(min, Math.min(max, startW + ev.clientX - startX));
        setWidth(latest);
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        setIsResizing(false);
        setWidth(latest);
        persistWidth(storageKey, latest);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [width, min, max, storageKey]
  );

  return { width, startResize, isResizing };
}
