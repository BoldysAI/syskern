import Image from "next/image";
import { cn } from "@/lib/utils";

const LOGOS = {
  syskern: {
    src: "/syskern-logo.png",
    alt: "Syskern — Pricing Platform",
    width: 304,
    height: 166,
  },
  unnikkern: {
    src: "/unnikkern-logo.png",
    alt: "Unikkern",
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
  const logo = LOGOS[variant];

  if (compact && variant === "syskern") {
    return (
      <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg bg-white p-1", className)}>
        <Image
          src={logo.src}
          alt="Syskern"
          width={logo.width}
          height={logo.height}
          className="h-full w-full object-contain"
          priority
        />
      </div>
    );
  }

  return (
    <Image
      src={logo.src}
      alt={logo.alt}
      width={logo.width}
      height={logo.height}
      className={cn("h-auto w-auto max-h-10 min-w-[120px] max-w-full object-contain", className)}
      priority
    />
  );
}
