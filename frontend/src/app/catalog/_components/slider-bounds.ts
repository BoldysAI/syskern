/** Compute slider min/max/step from catalog bounds. */

export function boundsToSliderConfig(
  bounds: { min: number | null; max: number | null } | null | undefined,
  fallbackMax: number,
): { min: number; max: number; step: number } {
  const rawMin = bounds?.min ?? 0;
  const rawMax = bounds?.max ?? fallbackMax;
  const min = Math.max(0, Math.floor(rawMin));
  let max = Math.ceil(rawMax);
  if (!Number.isFinite(max) || max <= min) max = fallbackMax;
  const span = max - min;
  let step = 1;
  if (span > 10_000) step = 100;
  else if (span > 1_000) step = 25;
  else if (span > 100) step = 5;
  return { min, max, step };
}

export function clampFilterValue(value: number | null | undefined, max: number): number | null {
  if (value == null || value <= 0) return null;
  return Math.min(value, max);
}
