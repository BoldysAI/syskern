"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";
import { useUiTranslate } from "@/lib/use-ui-translate";

const LOGOS = {
  syskern: {
    src: "/syskern-logo.png",
    width: 304,
    height: 166,
  },
  unnikkern: {
    src: "/unnikkern-logo.png",
    width: 150,
    height: 40,
  },
} as const;

export type BrandLogoVariant = keyof typeof LOGOS;

interface BrandLogoProps {
  variant: BrandLogoVariant;
  className?: string;
  /** Collapsed sidebar — smaller icon-only display */
  compact?: boolean;
}

export function BrandLogo({ variant, className, compact }: BrandLogoProps) {
  const t = useUiTranslate();
  const logo = LOGOS[variant];
  const alt = compact && variant === "syskern"
    ? t("brand.syskern")
    : variant === "unnikkern"
      ? t("brand.unnikkern")
      : t("brand.syskernPlatform");

  return (
    <Image
      src={logo.src}
      alt={alt}
      width={logo.width}
      height={logo.height}
      className={cn("object-contain", compact ? undefined : "object-center", className)}
      priority
    />
  );
}
