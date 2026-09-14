import { cn } from "@/lib/utils";

interface BrandLogoProps {
  className?: string;
  /** Collapsed sidebar — compact initials */
  compact?: boolean;
}

/** Generic wordmark for the throwaway demo branch (no client logo). */
export function BrandLogo({ className, compact }: BrandLogoProps) {
  return (
    <span
      title="Pricing Platform"
      className={cn(
        "inline-flex items-center justify-center text-center font-sans font-extrabold tracking-tight text-brand-navy",
        compact ? "text-sm" : "text-base leading-tight",
        className,
      )}
    >
      {compact ? "PP" : "Pricing Platform"}
    </span>
  );
}
