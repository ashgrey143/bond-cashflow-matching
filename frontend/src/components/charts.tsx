import * as React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Categorical slots in fixed order (validated reference palette). */
export const S = Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`);

export const axisProps = {
  stroke: "var(--chart-axis)",
  tickLine: false,
  axisLine: { stroke: "var(--chart-axis)" },
  tick: { fill: "var(--chart-muted)", fontSize: 11 },
} as const;

export const gridProps = { stroke: "var(--chart-grid)", strokeDasharray: "0", vertical: false } as const;

export function ChartCard({ title, description, children, right, className, contentClassName }: {
  title: React.ReactNode; description?: React.ReactNode; children: React.ReactNode; right?: React.ReactNode;
  className?: string; contentClassName?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {right}
      </CardHeader>
      <CardContent className={contentClassName}>{children}</CardContent>
    </Card>
  );
}

/** Tooltip body for recharts: rows of swatch, label, formatted value. */
export function TipBox({ title, rows, footer }: {
  title?: React.ReactNode;
  rows: { color?: string; label: React.ReactNode; value: React.ReactNode; strong?: boolean; dashed?: boolean }[];
  footer?: React.ReactNode;
}) {
  return (
    <div className="min-w-[180px] rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
      {title && <div className="mb-1.5 font-semibold">{title}</div>}
      <div className="space-y-1">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              {r.color && (
                <span className="inline-block h-2.5 w-2.5 rounded-[3px]"
                  style={r.dashed ? { border: `2px dashed ${r.color}` } : { background: r.color }} />
              )}
              {r.label}
            </span>
            <span className={cn("tnum", r.strong && "font-semibold")}>{r.value}</span>
          </div>
        ))}
      </div>
      {footer && <div className="mt-1.5 border-t pt-1.5 text-muted-foreground">{footer}</div>}
    </div>
  );
}

/** Legend rendered in HTML (text stays in ink colors; swatch carries identity). */
export function Legend({ items, className }: { items: { color: string; label: string; dashed?: boolean; line?: boolean }[]; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground", className)}>
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5">
          {it.line ? (
            <span className="inline-block w-4" style={{ borderTop: `2px ${it.dashed ? "dashed" : "solid"} ${it.color}` }} />
          ) : (
            <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: it.color }} />
          )}
          {it.label}
        </span>
      ))}
    </div>
  );
}

export function Stat({ label, value, sub, tone, icon, hint }: {
  label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "good" | "warn" | "critical"; icon?: React.ReactNode; hint?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground [&_svg]:size-3.5">
        {icon}
        {label}
        {hint}
      </div>
      <div className={cn("mt-1.5 text-[22px] font-semibold leading-none tracking-tight",
        tone === "good" && "text-[var(--good-text)]", tone === "critical" && "text-[var(--status-critical)]")}>
        {value}
      </div>
      {sub && <div className="mt-1.5 text-[11.5px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
