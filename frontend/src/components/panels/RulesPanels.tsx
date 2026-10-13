import { Briefcase, Filter, Plus, Scale, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { NativeSelect } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { money } from "@/lib/format";
import type { Filters, Options } from "@/lib/types";
import { Field, NumberInput, Section } from "./common";

const CR = 1e7;

export function UniversePanel({ filters, setFilters, names, eligible }: {
  filters: Filters; setFilters: (f: Filters) => void; names: Record<string, string>; eligible?: number;
}) {
  const set = (p: Partial<Filters>) => setFilters({ ...filters, ...p });
  const types: [keyof Filters, string, string][] = [
    ["include_gsec", "Central G-Secs", "Fixed-coupon Government of India bonds"],
    ["include_tbill", "Treasury bills", "Zero-coupon, up to 1 year. Useful for near-term payments"],
    ["include_sdl", "State loans (SDL)", "State government bonds: slightly higher yield, state credit"],
  ];
  return (
    <Section icon={<Filter />} step={3} title="Bonds to consider" subtitle={eligible != null ? `${eligible} eligible after filters` : undefined}>
      <div className="space-y-2">
        {types.map(([k, label, hint]) => (
          <label key={k} className="flex cursor-pointer items-center justify-between gap-3 rounded-md px-1 py-0.5">
            <div>
              <div className="text-[13px] font-medium">{label}</div>
              <div className="text-[11px] text-muted-foreground">{hint}</div>
            </div>
            <Switch checked={filters[k] as boolean} onCheckedChange={(v) => set({ [k]: v } as Partial<Filters>)} />
          </label>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Min. trades" hint="Skip bonds that traded fewer times on the day: their prices are less reliable.">
          <NumberInput value={filters.min_trades} onChange={(v) => set({ min_trades: v ?? 0 })} min={0} step={1} />
        </Field>
        <Field label="Min. volume" hint="Minimum value traded on the day, in ₹ crore.">
          <NumberInput value={filters.min_volume} onChange={(v) => set({ min_volume: v ?? 0 })} min={0} step={1} suffix="₹ cr" />
        </Field>
        <Field label="Max. price age" hint="Days since the bond last traded in this dataset." className="col-span-2">
          <NativeSelect value={filters.max_stale_days} onChange={(e) => set({ max_stale_days: Number(e.target.value) })}>
            <option value={99}>Any</option><option value={0}>Latest day only</option><option value={1}>Up to 1 day old</option><option value={3}>Up to 3 days old</option>
          </NativeSelect>
        </Field>
      </div>
      {filters.exclude.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-foreground/80">Excluded by you</div>
          <div className="flex flex-wrap gap-1">
            {filters.exclude.map((isin) => (
              <Badge key={isin} variant="secondary" className="gap-1 pr-1">
                {names[isin] ?? isin}
                <button onClick={() => set({ exclude: filters.exclude.filter((x) => x !== isin) })} aria-label="Include again"><X /></button>
              </Badge>
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}

export function RulesPanel({ options, setOptions }: { options: Options; setOptions: (o: Options) => void }) {
  const set = (p: Partial<Options>) => setOptions({ ...options, ...p });
  return (
    <Section icon={<Scale />} step={4} title="Investment rules" subtitle="Budget, limits and costs">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Budget" hint="Leave empty for no limit. If the budget is too small the model covers the earliest payments first and reports the shortfall.">
          <NumberInput value={options.budget == null ? null : +(options.budget / CR).toFixed(4)} allowEmpty placeholder="No limit"
            onChange={(v) => set({ budget: v == null || v <= 0 ? null : v * CR })} min={0} step={0.5} suffix="₹ cr" />
        </Field>
        <Field label="Safety margin" hint="Cover more than each payment, e.g. 102% keeps a 2% buffer.">
          <NumberInput value={options.safety_margin} onChange={(v) => set({ safety_margin: v ?? 100 })} min={50} max={200} step={1} suffix="%" />
        </Field>
      </div>
      <Field label={`Max. in one bond: ${options.max_weight >= 100 ? "no limit" : `${options.max_weight}%`}`}
        hint="Spreads the money so one bond can't sink the plan. The 'Strategies' tab shows what each limit costs.">
        <Slider value={[options.max_weight]} min={10} max={100} step={5} onValueChange={([v]) => set({ max_weight: v })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Buy in lots of" hint="Whole lots only (face value). Off = fractional amounts, the pure LP.">
          <NativeSelect value={options.lot_face} onChange={(e) => set({ lot_face: Number(e.target.value) })}>
            <option value={0}>Any amount</option>
            <option value={10000}>₹10,000</option>
            <option value={100000}>₹1 lakh</option>
            <option value={1000000}>₹10 lakh</option>
            <option value={10000000}>₹1 crore</option>
            <option value={50000000}>₹5 crore (NDS-OM lot)</option>
          </NativeSelect>
        </Field>
        <Field label="Max. % of day volume" hint="Cap each order at this share of the bond's traded volume. 0 = off.">
          <NumberInput value={options.max_volume_pct} onChange={(v) => set({ max_volume_pct: v ?? 0 })} min={0} step={5} suffix="%" />
        </Field>
        <Field label="Transaction cost" hint="Added to the dirty price of every purchase (bid-ask, brokerage).">
          <NumberInput value={options.tx_cost_bp} onChange={(v) => set({ tx_cost_bp: v ?? 0 })} min={0} step={1} suffix="bp" />
        </Field>
        <Field label="Reinvestment rate" hint="Interest earned on cash waiting for the next payment (e.g. a liquid fund). 0% is the conservative choice.">
          <NumberInput value={options.reinvest_rate} onChange={(v) => set({ reinvest_rate: v ?? 0 })} min={0} max={15} step={0.25} suffix="%" />
        </Field>
      </div>
    </Section>
  );
}

export function HoldingsPanel({ options, setOptions, names }: { options: Options; setOptions: (o: Options) => void; names: Record<string, string> }) {
  const h = options.holdings;
  const set = (holdings: Options["holdings"]) => setOptions({ ...options, holdings });
  const total = h.reduce((s, x) => s + (x.face || 0), 0);
  return (
    <Section icon={<Briefcase />} step={5} title="Bonds you already hold" defaultOpen={false}
      subtitle={h.length ? `${h.length} holdings · ${money(total)} face` : "Optional: only buy what is missing"}>
      <p className="text-[11.5px] text-muted-foreground">Their coupons and redemptions are counted first. Enter the ISIN and face value.</p>
      {h.map((x, i) => (
        <div key={i} className="grid grid-cols-[1fr_92px_28px] items-center gap-2">
          <div>
            <Input value={x.isin} placeholder="IN0020…" onChange={(e) => set(h.map((y, k) => (k === i ? { ...y, isin: e.target.value.trim().toUpperCase() } : y)))} />
            {x.isin && <div className="mt-0.5 truncate text-[10.5px] text-muted-foreground">{names[x.isin] ?? "Not in this dataset"}</div>}
          </div>
          <NumberInput value={+(x.face / CR).toFixed(4)} min={0} step={0.1} suffix="cr"
            onChange={(v) => set(h.map((y, k) => (k === i ? { ...y, face: (v ?? 0) * CR } : y)))} />
          <Button size="icon-sm" variant="ghost" onClick={() => set(h.filter((_, k) => k !== i))} aria-label="Remove"><Trash2 className="text-muted-foreground" /></Button>
        </div>
      ))}
      <Button size="sm" variant="ghost" className="w-full text-primary" onClick={() => set([...h, { isin: "", face: CR }])}><Plus /> Add holding</Button>
    </Section>
  );
}
