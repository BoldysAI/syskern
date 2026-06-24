import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const pageHeaderVariants = cva("flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between", {
  variants: {
    variant: {
      default: "mb-6",
      dense: "mb-4",
      hero: "mb-4 border-b border-border pb-4",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

const titleVariants = cva("font-bold tracking-tight text-foreground", {
  variants: {
    variant: {
      default: "text-2xl",
      dense: "text-xl",
      hero: "text-xl sm:text-2xl",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

interface PageHeaderProps extends VariantProps<typeof pageHeaderVariants> {
  title: string;
  description?: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  meta,
  actions,
  variant,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn(pageHeaderVariants({ variant }), className)}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className={titleVariants({ variant })}>{title}</h1>
          {meta}
        </div>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
