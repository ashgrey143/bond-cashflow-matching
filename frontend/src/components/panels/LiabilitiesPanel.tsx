import * as React from "react";
import { CalendarClock, FileSpreadsheet, Plus, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { date, money } from "@/lib/format";
import type { Liability } from "@/lib/types";
import { Field, NumberInput, Section } from "./common";

const CR = 1e7;

function addMonths(iso: string, m: number): string {
  const [y, mo, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, mo - 1 + m, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

export function LiabilitiesPanel({ liabilities, setLiabilities, settle, onReset }: {
  liabilities: Liability[]; setLiabilities: (l: Liability[]) => void; settle?: string; onReset: () => void;
}) {
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [genOpen, setGenOpen] = React.useState(false);
  const total = liabilities.reduce((s, l) => s + (l.amount || 0), 0);

  const update = (i: number, patch: Partial<Liability>) =>
    setLiabilities(liabilities.map((l, k) => (k === i ? { ...l, ...patch } : l)));

  const sorted = [...liabilities].map((l, i) => ({ ...l, i })).sort((a, b) => a.date.localeCompare(b.date));

  return (
    <Section icon={<CalendarClock />} step={2} title="Future payments (liabilities)"
      subtitle={`${liabilities.length} payments · ${money(total)} in total`}>
      <div className="flex gap-1.5">
        <Button size="sm" variant="outline" className="flex-1" onClick={() => setGenOpen(true)}><Sparkles /> Pattern</Button>
        <Button size="sm" variant="outline" className="flex-1" onClick={() => fileRef.current?.click()}><FileSpreadsheet /> CSV / Excel</Button>
        <Button size="icon-sm" variant="ghost" className="h-8 w-8" onClick={onReset} title="Reset to example"><RotateCcw /></Button>
        <input ref={fileRef} type="file" hidden accept=".csv,.xlsx,.xls" onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          try {
            const r = await api.parseLiabilities(f);
            setLiabilities(r.liabilities);
            toast.success(`Loaded ${r.liabilities.length} payments${r.scaled_from_crore ? " (amounts read as ₹ crore)" : ""}`);
          } catch (err) {
            toast.error(String((err as Error).message));
          }
        }} />
      </div>

      <div className="overflow-hidden rounded-lg border">
        <div className="grid grid-cols-[1fr_96px_28px] gap-2 border-b bg-muted/50 px-2.5 py-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
          <span>Payment date</span><span className="text-right">₹ crore</span><span />
        </div>
        <div className="max-h-64 overflow-y-auto scroll-thin">
          {sorted.map((l) => {
            const before = settle && l.date <= settle;
            return (
              <div key={l.i} className="grid grid-cols-[1fr_96px_28px] items-center gap-2 border-b px-2.5 py-1.5 last:border-b-0">
                <Input type="date" value={l.date} onChange={(e) => update(l.i, { date: e.target.value })}
                  className={before ? "border-[var(--status-critical)] text-[var(--status-critical)]" : ""}
                  title={before ? "On or before settlement: ignored" : undefined} />
                <NumberInput value={+(l.amount / CR).toFixed(4)} min={0} step={0.1}
                  onChange={(v) => update(l.i, { amount: (v ?? 0) * CR })} className="[&_input]:text-right" />
                <Button size="icon-sm" variant="ghost" onClick={() => setLiabilities(liabilities.filter((_, k) => k !== l.i))} aria-label="Remove payment">
                  <Trash2 className="text-muted-foreground" />
                </Button>
              </div>
            );
          })}
          {liabilities.length === 0 && <div className="px-3 py-4 text-center text-xs text-muted-foreground">No payments yet</div>}
        </div>
      </div>
      <Button size="sm" variant="ghost" className="w-full text-primary" onClick={() => {
        const last = sorted.length ? sorted[sorted.length - 1] : null;
        setLiabilities([...liabilities, { date: last ? addMonths(last.date, 12) : addMonths(settle ?? new Date().toISOString().slice(0, 10), 6), amount: last?.amount ?? CR }]);
      }}>
        <Plus /> Add payment
      </Button>

      <PatternDialog open={genOpen} onOpenChange={setGenOpen} settle={settle} onApply={(l) => { setLiabilities(l); setGenOpen(false); }} />
    </Section>
  );
}

function PatternDialog({ open, onOpenChange, settle, onApply }: {
  open: boolean; onOpenChange: (o: boolean) => void; settle?: string; onApply: (l: Liability[]) => void;
}) {
  const startDefault = settle ? addMonths(settle, 6) : "2027-03-31";
  const [start, setStart] = React.useState(startDefault);
  const [freq, setFreq] = React.useState(6);
  const [count, setCount] = React.useState<number | null>(10);
  const [amount, setAmount] = React.useState<number | null>(0.5);
  const [growth, setGrowth] = React.useState<number | null>(5);
  React.useEffect(() => { if (open && settle && start <= settle) setStart(addMonths(settle, 6)); }, [open, settle, start]);

  const preview: Liability[] = Array.from({ length: Math.max(0, Math.min(count ?? 0, 120)) }, (_, k) => ({
    date: addMonths(start, k * freq),
    amount: (amount ?? 0) * CR * Math.pow(1 + (growth ?? 0) / 100, (k * freq) / 12),
  }));
  const total = preview.reduce((s, l) => s + l.amount, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Generate a payment schedule</DialogTitle>
          <DialogDescription>For pension-style payouts: a regular amount that grows each year.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First payment"><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="Every">
            <NativeSelect value={freq} onChange={(e) => setFreq(Number(e.target.value))}>
              <option value={1}>Month</option><option value={3}>Quarter</option>
              <option value={6}>6 months</option><option value={12}>Year</option>
            </NativeSelect>
          </Field>
          <Field label="Number of payments"><NumberInput value={count} onChange={setCount} min={1} max={120} step={1} /></Field>
          <Field label="First amount"><NumberInput value={amount} onChange={setAmount} min={0} step={0.1} suffix="₹ cr" /></Field>
          <Field label="Growth per year" className="col-span-2"><NumberInput value={growth} onChange={setGrowth} step={0.5} suffix="%" /></Field>
        </div>
        <div className="rounded-lg border bg-muted/40 p-3 text-xs">
          <div className="flex justify-between"><span className="text-muted-foreground">Payments</span><span>{preview.length}, {date(preview[0]?.date)} → {date(preview.at(-1)?.date)}</span></div>
          <div className="mt-1 flex justify-between"><span className="text-muted-foreground">Last amount</span><span>{money(preview.at(-1)?.amount)}</span></div>
          <div className="mt-1 flex justify-between font-medium"><span>Total</span><span>{money(total)}</span></div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => onApply(preview)} disabled={!preview.length}>Replace schedule</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
