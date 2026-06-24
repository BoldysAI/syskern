import { cn } from "@/lib/utils";

interface KpiCardProps {
  label: string;
  value: React.ReactNode;
  subValue?: React.ReactNode;
  accent?: "default" | "warm" | "green" | "blue";
  className?: string;
}

const accentStyles = {
  default: "border-border",
  warm: "border-warm/30 bg-warm/5",
  green: "border-brand-green/30 bg-brand-green/5",
  blue: "border-brand-blue/30 bg-brand-blue/5",
} as const;

export function KpiCard({ label, value, subValue, accent = "default", className }: KpiCardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-4 shadow-sm",
        accentStyles[accent],
        className,
      )}
    >
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold font-data text-foreground">{value}</p>
      {subValue && (
        <p className="mt-0.5 text-xs text-muted-foreground">{subValue}</p>
      )}
    </div>
  );
}
