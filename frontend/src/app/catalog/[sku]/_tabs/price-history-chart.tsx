import type { DotProps } from "recharts";
import type { PriceHistoryPoint } from "@/lib/api";

type ClickableDotPayload = {
  simulationId?: string;
};

/** Large invisible hit target + visible dot — Recharts LineChart onClick is unreliable. */
export function createClickableHistoryDot(onSelect: (simulationId: string) => void) {
  return function ClickableHistoryDot(props: DotProps) {
    const { cx, cy, stroke, payload } = props;
    const simulationId = (payload as ClickableDotPayload | undefined)?.simulationId;
    if (cx == null || cy == null) return null;

    return (
      <g>
        <circle
          cx={cx}
          cy={cy}
          r={12}
          fill="transparent"
          className="cursor-pointer"
          onPointerUp={(e) => {
            e.stopPropagation();
            if (simulationId) onSelect(simulationId);
          }}
        />
        <circle cx={cx} cy={cy} r={4} fill={stroke} stroke={stroke} strokeWidth={1} pointerEvents="none" />
      </g>
    );
  };
}

/** One point per calendar day — keeps the latest simulation when several fall on the same day. */
export function collapsePriceHistoryByDay(points: PriceHistoryPoint[]): PriceHistoryPoint[] {
  const byDay = new Map<string, PriceHistoryPoint>();
  for (const p of points) {
    const dayKey = p.date.slice(0, 10);
    const prev = byDay.get(dayKey);
    if (!prev || new Date(p.date).getTime() > new Date(prev.date).getTime()) {
      byDay.set(dayKey, p);
    }
  }
  return [...byDay.values()].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

export function formatPriceHistoryAxisLabel(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
  });
}

export function formatPriceHistoryTooltipLabel(isoDate: string, simulationLabel?: string): string {
  const when = new Date(isoDate).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return simulationLabel ? `${when} — ${simulationLabel}` : when;
}

/** Recharts v3 exposes tooltip index as string — normalize for chartData lookup. */
export function resolveChartPointIndex(
  state: { activeTooltipIndex?: unknown; activeIndex?: unknown } | null | undefined,
): number | null {
  const raw = state?.activeTooltipIndex ?? state?.activeIndex;
  if (raw == null) return null;
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
