import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors [&_svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary/10 text-primary",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "text-muted-foreground",
        good: "border-transparent bg-[color-mix(in_srgb,var(--status-good)_14%,transparent)] text-[var(--good-text)]",
        warn: "border-transparent bg-[color-mix(in_srgb,var(--status-warning)_22%,transparent)] text-amber-800 dark:text-amber-300",
        critical: "border-transparent bg-[color-mix(in_srgb,var(--status-critical)_14%,transparent)] text-[var(--status-critical)]",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
