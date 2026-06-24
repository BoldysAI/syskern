import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const statusBadgeVariants = cva(
  "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold",
  {
    variants: {
      variant: {
        draft: "border-border bg-muted text-muted-foreground",
        running: "border-brand-blue/30 bg-brand-blue/10 text-brand-blue",
        completed: "border-brand-green/30 bg-brand-green/10 text-brand-green",
        failed: "border-destructive/30 bg-destructive/10 text-destructive",
        warning: "border-warm/30 bg-warm/10 text-warm",
        info: "border-brand-blue/30 bg-brand-blue/10 text-brand-blue",
        success: "border-brand-green/30 bg-brand-green/10 text-brand-green",
        default: "border-border bg-secondary text-secondary-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface StatusBadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof statusBadgeVariants> {}

export function StatusBadge({ className, variant, ...props }: StatusBadgeProps) {
  return <span className={cn(statusBadgeVariants({ variant }), className)} {...props} />;
}

/** Map simulation status strings to badge variants */
export function simulationStatusVariant(
  status: string,
): VariantProps<typeof statusBadgeVariants>["variant"] {
  switch (status) {
    case "draft":
      return "draft";
    case "running":
    case "calculating":
      return "running";
    case "completed":
    case "done":
      return "completed";
    case "failed":
    case "error":
      return "failed";
    default:
      return "default";
  }
}

/** Map offer lifecycle status to badge variants */
export function offerStatusVariant(
  status: string,
): VariantProps<typeof statusBadgeVariants>["variant"] {
  switch (status) {
    case "draft":
      return "draft";
    case "sent":
      return "info";
    case "won":
      return "success";
    case "lost":
      return "failed";
    case "expired":
      return "warning";
    default:
      return "default";
  }
}
