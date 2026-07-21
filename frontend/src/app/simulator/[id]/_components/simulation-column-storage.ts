/** Registry + persistence of simulation table column visibility (FEEDBACK 2). */

export interface SimulationColumnMeta {
  key: string;
  label: string;
  /** Cannot be hidden (SKU). */
  locked?: boolean;
  /** Only shown for project simulations. */
  projectOnly?: boolean;
}

/** All toggleable simulation line columns (display order). */
export const SIMULATION_COLUMN_META: SimulationColumnMeta[] = [
  { key: "product_sku", label: "SKU", locked: true },
  { key: "designation", label: "Désignation" },
  { key: "product_range", label: "Gamme" },
  { key: "product_stock", label: "Stock" },
  { key: "product_pamp_eur", label: "PAMP" },
  { key: "pamp_predictive_eur", label: "PAMP prév." },
  { key: "quantity", label: "Quantité", projectOnly: true },
  { key: "mix", label: "Mix eff." },
  { key: "pa_net_eur", label: "PA net" },
  { key: "pr_eur", label: "PR" },
  { key: "margin", label: "Marge eff." },
  { key: "previous_pv_eur", label: "Dernier PV" },
  { key: "pv_eur", label: "PV" },
  { key: "pv_total_eur", label: "Prix total", projectOnly: true },
  { key: "status", label: "Statut" },
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
