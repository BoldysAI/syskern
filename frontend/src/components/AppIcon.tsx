import type { IconProps, IconWeight } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

const SIZE_MAP = {
  sm: 16,
  md: 20,
  lg: 24,
  xl: 32,
} as const;

export type AppIconSize = keyof typeof SIZE_MAP;
export type AppIconWeight = Extract<IconWeight, "regular" | "duotone">;

interface AppIconProps {
  icon: React.ComponentType<IconProps>;
  size?: AppIconSize;
  weight?: AppIconWeight;
  className?: string;
  "aria-hidden"?: boolean;
}

export function AppIcon({
  icon: Icon,
  size = "md",
  weight = "regular",
  className,
  "aria-hidden": ariaHidden = true,
}: AppIconProps) {
  return (
    <Icon
      size={SIZE_MAP[size]}
      weight={weight}
      className={cn("shrink-0", className)}
      aria-hidden={ariaHidden}
    />
  );
}

interface AppIconCircleProps extends AppIconProps {
  tone?: "primary" | "warm" | "blue" | "navy" | "muted";
}

const TONE_STYLES = {
  primary: "bg-brand-green/10 text-brand-green",
  warm: "bg-warm/10 text-warm",
  blue: "bg-brand-blue/10 text-brand-blue",
  navy: "bg-brand-navy/10 text-brand-navy",
  muted: "bg-muted text-muted-foreground",
} as const;

export function AppIconCircle({
  tone = "primary",
  size = "md",
  className,
  ...props
}: AppIconCircleProps) {
  const boxSize =
    size === "sm"
      ? "h-8 w-8"
      : size === "lg"
        ? "h-12 w-12"
        : size === "xl"
          ? "h-14 w-14"
          : "h-10 w-10";
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-xl",
        boxSize,
        TONE_STYLES[tone],
        className,
      )}
    >
      <AppIcon size={size === "xl" ? "lg" : size} {...props} />
    </span>
  );
}
