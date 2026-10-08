/** Registry + persistence of simulation table column visibility (FEEDBACK 2). */

import { translate, type MessageKey } from "@/lib/i18n";

export interface SimulationColumnMeta {
  key: string;
  /** Cannot be hidden (SKU). */
  locked?: boolean;
  /** Only shown for project simulations. */
  projectOnly?: boolean;
}

const COLUMN_LABEL_KEYS: Record<string, MessageKey> = {
  product_sku: "simulator.column.sku",
  designation: "simulator.column.designation",
  product_range: "simulator.column.range",
  product_stock: "simulator.column.stock",
  product_pamp_eur: "simulator.column.pamp",
  pamp_predictive_eur: "simulator.column.pampPredictiveShort",
  quantity: "simulator.column.quantity",
  mix: "simulator.column.mixEffective",
  pa_net_eur: "simulator.column.paNet",
  pr_eur: "simulator.column.pr",
  margin: "simulator.column.marginEffective",
  previous_pv_eur: "simulator.column.previousPv",
  pv_eur: "simulator.column.pv",
  pv_total_eur: "simulator.column.totalPrice",
  status: "simulator.column.status",
};

export function simulationColumnLabel(key: string, locale: string): string {
  const messageKey = COLUMN_LABEL_KEYS[key];
  return messageKey ? translate(messageKey, locale) : key;
}

/** All toggleable simulation line columns (display order). */
export const SIMULATION_COLUMN_META: SimulationColumnMeta[] = [
  { key: "product_sku", locked: true },
  { key: "designation" },
  { key: "product_range" },
  { key: "product_stock" },
  { key: "product_pamp_eur" },
  { key: "pamp_predictive_eur" },
  { key: "quantity", projectOnly: true },
  { key: "mix" },
  { key: "pa_net_eur" },
  { key: "pr_eur" },
  { key: "margin" },
  { key: "previous_pv_eur" },
  { key: "pv_eur" },
  { key: "pv_total_eur", projectOnly: true },
  { key: "status" },
];

export const SIMULATION_COLUMN_ORDER: string[] = SIMULATION_COLUMN_META.map((c) => c.key);

/** Default visible columns (all, including Dernier PV). */
export const DEFAULT_VISIBLE_SIMULATION_COLUMNS: string[] = [...SIMULATION_COLUMN_ORDER];

export const SIMULATION_VISIBLE_COLUMNS_KEY = "syskern:simulation-visible-columns:v1";
/** @deprecated migrated to SIMULATION_VISIBLE_COLUMNS_KEY */
const LEGACY_OPTIONAL_COLUMNS_KEY = "syskern:simulation-optional-columns:v1";

const ALLOWED = new Set(SIMULATION_COLUMN_ORDER);

export function availableSimulationColumns(isProject: boolean): SimulationColumnMeta[] {
  return SIMULATION_COLUMN_META.filter((c) => isProject || !c.projectOnly);
}

export function orderVisibleSimulationColumns(keys: string[], isProject: boolean): string[] {
  const visible = new Set(keys);
  return availableSimulationColumns(isProject)
    .map((c) => c.key)
    .filter((k) => visible.has(k));
}

export function ensureLockedSimulationColumns(keys: string[], isProject: boolean): string[] {
  const set = new Set(keys.filter((k) => ALLOWED.has(k)));
  for (const c of SIMULATION_COLUMN_META) {
    if (c.locked) set.add(c.key);
    if (c.projectOnly && !isProject) set.delete(c.key);
  }
  return orderVisibleSimulationColumns([...set], isProject);
}

export function loadVisibleSimulationColumns(isProject: boolean): string[] {
  const defaults = ensureLockedSimulationColumns(DEFAULT_VISIBLE_SIMULATION_COLUMNS, isProject);
  if (typeof window === "undefined") return defaults;
  try {
    const raw = window.localStorage.getItem(SIMULATION_VISIBLE_COLUMNS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed) && parsed.every((k) => typeof k === "string")) {
        return ensureLockedSimulationColumns(parsed, isProject);
      }
    }
    // Migrate FEEDBACK 2 v0 optional-only storage.
    const legacy = window.localStorage.getItem(LEGACY_OPTIONAL_COLUMNS_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy) as unknown;
      if (Array.isArray(parsed) && parsed.every((k) => typeof k === "string")) {
        const base = DEFAULT_VISIBLE_SIMULATION_COLUMNS.filter((k) => k !== "previous_pv_eur");
        const withPrevious = parsed.includes("previous_pv_eur")
          ? [...base, "previous_pv_eur"]
          : base;
        const migrated = ensureLockedSimulationColumns(withPrevious, isProject);
        saveVisibleSimulationColumns(migrated);
        return migrated;
      }
    }
  } catch {
    /* ignore */
  }
  return defaults;
}

export function saveVisibleSimulationColumns(keys: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SIMULATION_VISIBLE_COLUMNS_KEY, JSON.stringify(keys));
  } catch {
    /* storage unavailable */
  }
}
