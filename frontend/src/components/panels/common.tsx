import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Hint } from "@/components/ui/tooltip";

export function Section({ icon, title, subtitle, children, defaultOpen = true, step, right }: {
  icon: React.ReactNode; title: string; subtitle?: React.ReactNode; children: React.ReactNode;
  defaultOpen?: boolean; step?: number; right?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <section className="border-b last:border-b-0">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary [&_svg]:size-4">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[13px] font-semibold">
            {step != null && <span className="text-muted-foreground">{step}.</span>}
            {title}
          </div>
          {subtitle && <div className="truncate text-[11.5px] text-muted-foreground">{subtitle}</div>}
        </div>
        {right}
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", !open && "-rotate-90")} />
      </button>
      {open && <div className="space-y-3 px-4 pb-4">{children}</div>}
    </section>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center gap-1.5">
        <Label>{label}</Label>
        {hint && <Hint>{hint}</Hint>}
      </div>
      {children}
    </div>
  );
}

/** Number input that lets the user type freely and reports parsed numbers. */
export function NumberInput({ value, onChange, suffix, prefix, min, max, step = "any", placeholder, allowEmpty, className }: {
  value: number | null; onChange: (v: number | null) => void; suffix?: string; prefix?: string;
  min?: number; max?: number; step?: number | "any"; placeholder?: string; allowEmpty?: boolean; className?: string;
}) {
  const [text, setText] = React.useState(value == null ? "" : String(value));
  React.useEffect(() => {
    const parsed = text === "" ? null : Number(text);
    if (parsed !== value) setText(value == null ? "" : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className={cn("relative", className)}>
      {prefix && <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{prefix}</span>}
      <Input
        inputMode="decimal"
        type="number"
        min={min}
        max={max}
        step={step}
        value={text}
        placeholder={placeholder}
        className={cn(prefix && "pl-6", suffix && "pr-10")}
        onChange={(e) => {
          const t = e.target.value;
          setText(t);
          if (t === "") {
            if (allowEmpty) onChange(null);
            return;
          }
          const n = Number(t);
          if (!Number.isNaN(n)) onChange(min != null ? Math.max(min, max != null ? Math.min(max, n) : n) : n);
        }}
      />
      {suffix && <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{suffix}</span>}
    </div>
  );
}
