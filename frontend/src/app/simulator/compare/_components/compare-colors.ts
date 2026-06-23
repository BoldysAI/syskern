/** Consistent palette for compare columns across charts & cards. */
export const COLUMN_PALETTE = ["#E07200", "#3B82F6", "#8B5CF6", "#10B981"] as const;

export interface ColumnVisual {
  key: string;
  label: string;
  color: string;
  isRef: boolean;
  shortLabel: string;
}

export function columnVisuals(labels: string[], keys: string[]): ColumnVisual[] {
  return keys.map((key, i) => ({
    key,
    label: labels[i] ?? key,
    shortLabel: truncate(labels[i] ?? key, 18),
    color: COLUMN_PALETTE[i % COLUMN_PALETTE.length],
    isRef: i === 0,
  }));
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function deltaColor(pct: number): string {
  const a = Math.abs(pct);
  if (a < 1) return "#10B981";
  if (a <= 5) return "#F59E0B";
  return "#EF4444";
}

export function deltaBg(pct: number): string {
  const a = Math.abs(pct);
  if (a < 1) return "bg-emerald-50 border-emerald-200";
  if (a <= 5) return "bg-amber-50 border-amber-200";
  return "bg-red-50 border-red-200";
}
