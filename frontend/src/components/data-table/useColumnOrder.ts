"use client";

import { useCallback, useMemo, useState } from "react";
import { arrayMove } from "@dnd-kit/sortable";
import type { DataTableColumnDef } from "./types";

function orderStorageKey(storageKey: string): string {
  return `${storageKey}:col-order`;
}

function loadOrder(storageKey: string, enabled: boolean): string[] {
  if (!enabled || typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(orderStorageKey(storageKey));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Persisted, drag-and-drop column ordering for {@link DataTable} (FEEDBACK 1).
 *
 * Returns the incoming columns re-ordered by the saved key order — unknown/new
 * columns are appended in their declared order, removed columns are dropped —
 * plus a `move(activeKey, overKey)` that reorders and persists. When `enabled`
 * is false it is a no-op passthrough (order = declared order).
 */
export function useColumnOrder<T>(
  columns: DataTableColumnDef<T>[],
  storageKey: string,
  enabled: boolean,
) {
  const [order, setOrder] = useState<string[]>(() => loadOrder(storageKey, enabled));

  const orderedColumns = useMemo(() => {
    if (!enabled || order.length === 0) return columns;
    const byKey = new Map(columns.map((c) => [c.key, c]));
    const seen = new Set<string>();
    const result: DataTableColumnDef<T>[] = [];
    for (const key of order) {
      const col = byKey.get(key);
      if (col) {
        result.push(col);
        seen.add(key);
      }
    }
    for (const col of columns) {
      if (!seen.has(col.key)) result.push(col);
    }
    return result;
  }, [columns, order, enabled]);

  const move = useCallback(
    (activeKey: string, overKey: string) => {
      const currentKeys = orderedColumns.map((c) => c.key);
      const from = currentKeys.indexOf(activeKey);
      const to = currentKeys.indexOf(overKey);
      if (from < 0 || to < 0 || from === to) return;
      const next = arrayMove(currentKeys, from, to);
      setOrder(next);
      try {
        window.localStorage.setItem(orderStorageKey(storageKey), JSON.stringify(next));
      } catch {
        /* storage unavailable — order stays in-memory */
      }
    },
    [orderedColumns, storageKey],
  );

  return { orderedColumns, move, reorderEnabled: enabled };
}
