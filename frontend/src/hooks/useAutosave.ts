"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type AutosaveStatus = "idle" | "saving" | "saved" | "error";

export interface UseAutosaveOptions {
  /** Debounce delay in ms before `onSave` fires (CDC §4.3 → 2s). */
  delay?: number;
  /** When false, watching is paused (e.g. read mode). */
  enabled?: boolean;
}

export interface UseAutosaveResult {
  status: AutosaveStatus;
  error: string | null;
  /** Reset the status back to idle (e.g. after a manual rollback). */
  reset: () => void;
}

/**
 * Debounced autosave for in-place editing (CDC §4.3).
 *
 * Watches `value`; every change schedules `onSave(value)` after `delay` ms.
 * Rapid successive changes reset the timer, so a burst of edits coalesces into
 * a single `onSave` call with the latest value. The initial value (freshly
 * loaded) is never saved.
 *
 * `value` must be referentially stable while unchanged — derive it with
 * `useMemo` from the editable draft so unrelated re-renders don't trigger saves.
 */
export function useAutosave<T>(
  value: T,
  onSave: (value: T) => Promise<void>,
  options: UseAutosaveOptions = {},
): UseAutosaveResult {
  const { delay = 2000, enabled = true } = options;

  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  // Keep the latest callback without making it a dependency of the effect.
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onSaveRef.current = onSave;
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextRef = useRef(true);
  // Monotonic run id: stale timers/results are ignored after a newer change.
  const runIdRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    // Never save the initial (or the just-loaded) value.
    if (skipNextRef.current) {
      skipNextRef.current = false;
      return;
    }

    setStatus("saving");
    setError(null);

    if (timerRef.current) clearTimeout(timerRef.current);
    const myRun = ++runIdRef.current;

    timerRef.current = setTimeout(() => {
      onSaveRef.current(value).then(
        () => {
          if (runIdRef.current === myRun) setStatus("saved");
        },
        (e: unknown) => {
          if (runIdRef.current !== myRun) return;
          setError(e instanceof Error ? e.message : "Erreur de sauvegarde");
          setStatus("error");
        },
      );
    }, delay);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [value, delay, enabled]);

  const reset = useCallback(() => {
    // Invalidate any in-flight save and forget pending timers.
    runIdRef.current += 1;
    skipNextRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    setStatus("idle");
    setError(null);
  }, []);

  return { status, error, reset };
}
