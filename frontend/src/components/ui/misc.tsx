import * as React from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export const Separator = ({ className }: { className?: string }) => <div className={cn("h-px w-full bg-border", className)} />;

export const Skeleton = ({ className }: { className?: string }) => (
  <div className={cn("animate-pulse rounded-md bg-muted", className)} />
);

type Tone = "info" | "good" | "warn" | "critical";
const toneStyle: Record<Tone, string> = {
  info: "border-primary/20 bg-primary/5",
  good: "border-[color-mix(in_srgb,var(--status-good)_30%,transparent)] bg-[color-mix(in_srgb,var(--status-good)_7%,transparent)]",
  warn: "border-[color-mix(in_srgb,var(--status-warning)_45%,transparent)] bg-[color-mix(in_srgb,var(--status-warning)_10%,transparent)]",
  critical: "border-[color-mix(in_srgb,var(--status-critical)_35%,transparent)] bg-[color-mix(in_srgb,var(--status-critical)_7%,transparent)]",
};
const toneIcon: Record<Tone, React.ReactNode> = {
  info: <Info className="h-4 w-4 text-primary" />,
  good: <CheckCircle2 className="h-4 w-4 text-[var(--status-good)]" />,
  warn: <AlertTriangle className="h-4 w-4 text-[var(--status-warning)]" />,
  critical: <XCircle className="h-4 w-4 text-[var(--status-critical)]" />,
};

export function Alert({ tone = "info", title, children, className }: { tone?: Tone; title?: React.ReactNode; children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex gap-3 rounded-lg border px-3.5 py-3 text-[13px]", toneStyle[tone], className)}>
      <div className="mt-0.5 shrink-0">{toneIcon[tone]}</div>
      <div className="space-y-0.5">
        {title && <div className="font-medium">{title}</div>}
        {children && <div className="text-muted-foreground">{children}</div>}
      </div>
    </div>
  );
}

/** Segmented control (single choice) */
export function Segmented<T extends string>({ value, onChange, options, className }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode; icon?: React.ReactNode }[]; className?: string;
}) {
  return (
    <div className={cn("grid gap-1 rounded-lg bg-muted p-1", className)} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }} role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition-all hover:text-foreground [&_svg]:size-3.5",
            value === o.value && "bg-card text-foreground shadow-sm",
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Native select with the input look */
export const NativeSelect = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn("h-8 w-full rounded-md border border-input bg-card px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40", className)}
      {...props}
    />
  ),
);
NativeSelect.displayName = "NativeSelect";
