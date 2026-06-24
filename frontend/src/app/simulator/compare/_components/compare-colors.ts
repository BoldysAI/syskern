/** Consistent palette for compare columns across charts & cards. */
export const COLUMN_PALETTE = ["#F78F26", "#09B0E6", "#649E5F", "#162F56"] as const;

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
  if (a < 1) return "#649E5F";
  if (a <= 5) return "#F78F26";
  return "#C92359";
}

export function deltaBg(pct: number): string {
  const a = Math.abs(pct);
  if (a < 1) return "bg-brand-green/10 border-brand-green/30";
  if (a <= 5) return "bg-warm/10 border-warm/30";
  return "bg-destructive/10 border-destructive/30";
}
