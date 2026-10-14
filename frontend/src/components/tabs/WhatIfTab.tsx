import * as React from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { FlaskConical, Loader2, Play, RotateCcw } from "lucide-react";
import { ChartCard, Legend, S, TipBox, axisProps, gridProps } from "@/components/charts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { axisCr, date, money, num, pct, ratioPct, shortName } from "@/lib/format";
import type { Result, Scenario } from "@/lib/types";

export function WhatIfTab({ r, runCustom }: { r: Result; runCustom: (c: Record<string, unknown>) => Promise<Scenario> }) {
  const sc = r.scenarios ?? [];
  const base = sc[0];
  const unc = r.uncertainty ?? [];
  const [rate, setRate] = React.useState(0);
  const [liab, setLiab] = React.useState(0);
  const [shift, setShift] = React.useState(0);
  const [remove, setRemove] = React.useState<string[]>([]);
  const [custom, setCustom] = React.useState<Scenario | null>(null);
  const [busy, setBusy] = React.useState(false);
  // a new optimisation makes the last custom result stale
  React.useEffect(() => setCustom(null), [r]);

  const [ranWith, setRanWith] = React.useState("");
  const inputsKey = JSON.stringify({ rate, liab, shift, remove });
  const stale = custom != null && ranWith !== inputsKey;
  const allSc = custom && custom.status !== "infeasible" ? [...sc, custom] : sc;
  const data = allSc.filter((s) => s.cost != null).map((s) => ({ name: s.name, cost: s.cost!, delta: s.delta_pct ?? 0, s }));
  const isins = (r.holdings ?? []).map((h) => ({ isin: h.isin, name: shortName(h.description) }));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-5">
        <ChartCard className="xl:col-span-3" title="Change in investment by scenario"
          description="Each scenario is re-optimised from scratch. Bars show the change from the base case; labels show the new cost.">
          <Legend className="mb-2" items={[{ color: S[7], label: "Costs more" }, { color: S[0], label: "Costs less" }]} />
          <ResponsiveContainer width="100%" height={Math.max(220, data.length * 44)}>
            <BarChart data={data.slice(1)} layout="vertical" margin={{ top: 4, right: 70, left: 8, bottom: 0 }} barCategoryGap="28%">
              <CartesianGrid {...gridProps} horizontal={false} vertical />
              <XAxis type="number" {...axisProps} padding={{ left: 56, right: 8 }} tickFormatter={(v) => `${v > 0 ? "+" : ""}${v}%`} domain={[(m: number) => Math.min(0, Math.floor(m)), (m: number) => Math.max(0, Math.ceil(m))]} />
              <YAxis type="category" dataKey="name" {...axisProps} width={170} tick={{ fill: "hsl(var(--foreground))", fontSize: 12 }} />
              <ReferenceLine x={0} stroke="var(--chart-axis)" />
              <Tooltip cursor={{ fill: "hsl(var(--muted))", opacity: 0.5 }} content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const s = payload[0].payload.s as Scenario;
                return <TipBox title={s.name} rows={[
                  { label: "Cost", value: money(s.cost), strong: true },
                  { label: "Change", value: `${money(s.delta_cost)} (${pct(s.delta_pct, 2)})` },
                  { label: "Bonds used", value: s.bonds_used },
                ]} footer={s.description} />;
              }} />
              <Bar dataKey="delta" radius={4} maxBarSize={26}>
                {data.slice(1).map((d) => <Cell key={d.name} fill={d.delta > 0 ? S[7] : S[0]} fillOpacity={d.name === "Custom scenario" ? 0.7 : 1} />)}
                <LabelList dataKey="cost" content={(p) => {
                  const { x = 0, y = 0, width = 0, height = 0, value } = p as { x?: number; y?: number; width?: number; height?: number; value?: number };
                  const neg = Number(width) < 0;
                  const end = Number(x) + Number(width);
                  return <text x={neg ? end - 6 : end + 6} y={Number(y) + Number(height) / 2} textAnchor={neg ? "end" : "start"}
                    dominantBaseline="middle" fontSize={11} fill="hsl(var(--muted-foreground))">{money(value)}</text>;
                }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="mt-1 text-[12px] text-muted-foreground">Base case: {money(base?.cost)}.</p>
        </ChartCard>

        <ChartCard className="xl:col-span-2" title="Build your own scenario" description="Combine shocks and re-optimise."
          right={<FlaskConical className="h-4 w-4 text-muted-foreground" />}>
          <div className="space-y-4">
            <SliderRow label="Interest rates" value={rate} min={-300} max={300} step={25} onChange={setRate} fmt={(v) => `${v > 0 ? "+" : ""}${v} bp`} />
            <SliderRow label="Liabilities" value={liab} min={-30} max={50} step={5} onChange={setLiab} fmt={(v) => `${v > 0 ? "+" : ""}${v}%`} />
            <SliderRow label="Payment timing" value={shift} min={-180} max={180} step={30} onChange={setShift} fmt={(v) => (v === 0 ? "on time" : `${Math.abs(v)} days ${v < 0 ? "earlier" : "later"}`)} />
            <div className="space-y-1.5">
              <Label>Make bonds unavailable</Label>
              <div className="flex flex-wrap gap-1.5">
                {isins.map((x) => (
                  <button key={x.isin} onClick={() => setRemove((r) => (r.includes(x.isin) ? r.filter((y) => y !== x.isin) : [...r, x.isin]))}
                    className={`rounded-md border px-2 py-1 text-[11.5px] transition-colors ${remove.includes(x.isin) ? "border-[var(--status-critical)] bg-[color-mix(in_srgb,var(--status-critical)_10%,transparent)] line-through" : "hover:bg-muted"}`}>
                    {x.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <Button className="flex-1" disabled={busy} onClick={async () => {
                setBusy(true);
                try {
                  setCustom(await runCustom({ rate_bp: rate, liab_pct: liab, shift_days: shift, remove }));
                  setRanWith(inputsKey);
                } finally { setBusy(false); }
              }}>
                {busy ? <Loader2 className="animate-spin" /> : <Play />} Run scenario
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => { setRate(0); setLiab(0); setShift(0); setRemove([]); setCustom(null); }}>
                <RotateCcw /> Reset
              </Button>
            </div>
            {custom && (
              <div className={`rounded-lg border bg-muted/30 p-3 text-[12.5px] ${stale ? "opacity-60" : ""}`}>
                <div className="mb-1.5 flex items-start justify-between gap-2">
                  <span className="font-medium">{custom.description}</span>
                  {stale && <Badge variant="warn" className="shrink-0 whitespace-nowrap">Changed, run again</Badge>}
                </div>
                {custom.status === "infeasible" ? <div className="text-[var(--status-critical)]">{custom.message}</div> : (
                  <div className="grid grid-cols-2 gap-y-1">
                    <span className="text-muted-foreground">New cost</span><span className="text-right font-semibold tnum">{money(custom.cost)}</span>
                    <span className="text-muted-foreground">Change vs base</span>
                    <span className={`text-right tnum ${(custom.delta_cost ?? 0) > 0 ? "text-[var(--status-critical)]" : "text-[var(--good-text)]"}`}>
                      {(custom.delta_cost ?? 0) > 0 ? "+" : ""}{money(custom.delta_cost)} ({pct(custom.delta_pct, 2)})
                    </span>
                    <span className="text-muted-foreground">Bonds used</span><span className="text-right tnum">{custom.bonds_used}</span>
                    <span className="text-muted-foreground">Payments covered</span><span className="text-right tnum">{ratioPct(custom.min_coverage, 0)}</span>
                    <span className="col-span-2 mt-1.5 border-t pt-1.5 text-muted-foreground">
                      {custom.base_without_removed ? "Today's plan without the unavailable bonds" : "Today's plan, unchanged"}:{" "}
                      <span className="text-foreground">
                        {(custom.base_portfolio_coverage ?? 0) >= 0.9999 ? "still covers every payment"
                          : `covers ${ratioPct(custom.base_portfolio_coverage, 0)} at worst, short ${money(custom.base_portfolio_shortfall)}`}
                      </span>
                    </span>
                  </div>
                )}
                {custom.status !== "infeasible" && <div className="mt-2 text-[11px] text-muted-foreground">Full plan below; also added to the chart and comparison table.</div>}
              </div>
            )}
          </div>
        </ChartCard>
      </div>

      {custom && custom.status !== "infeasible" && custom.holdings && (
        <ChartCard title="Custom scenario: the new plan"
          description={`Re-optimised from scratch over all eligible bonds (${custom.description}). Compared with today's plan.`}
          right={stale ? <Badge variant="warn" className="whitespace-nowrap">Changed, run again</Badge> : undefined}
          contentClassName="p-0">
          {custom.message && <div className="px-5 pb-3"><Alert tone="warn">{custom.message}</Alert></div>}
          <div className="grid gap-0 xl:grid-cols-5">
            <div className="xl:col-span-3 xl:border-r">
              <Table>
                <THead><TR><TH>Bond selected</TH><TH>Maturity</TH><TH className="text-right">Face value</TH>
                  <TH className="text-right">vs today</TH><TH className="text-right">Cost</TH><TH className="text-right">Yield</TH></TR></THead>
                <TBody>
                  {custom.holdings.map((h) => {
                    const d = h.face - h.base_face;
                    return (
                      <TR key={h.isin}>
                        <TD><div className="flex items-center gap-1.5 font-medium">{shortName(h.description)}
                          {h.base_face === 0 && <Badge>new</Badge>}</div>
                          <div className="text-[11px] text-muted-foreground">{h.isin}</div></TD>
                        <TD>{date(h.maturity)}</TD>
                        <TD className="text-right font-medium">{money(h.face)}</TD>
                        <TD className={`text-right ${Math.abs(d) < 1 ? "text-muted-foreground" : d > 0 ? "text-[var(--status-critical)]" : "text-[var(--good-text)]"}`}>
                          {Math.abs(d) < 1 ? "same" : `${d > 0 ? "+" : "−"}${money(Math.abs(d))}`}</TD>
                        <TD className="text-right">{money(h.cost)}</TD>
                        <TD className="text-right">{pct(h.yield, 2)}</TD>
                      </TR>
                    );
                  })}
                  {custom.dropped?.map((h) => (
                    <TR key={h.isin} className="opacity-70">
                      <TD><div className="flex items-center gap-1.5 font-medium line-through">{shortName(h.description)}</div>
                        <div className="text-[11px] text-muted-foreground">{h.isin} · no longer used</div></TD>
                      <TD>—</TD><TD className="text-right">—</TD>
                      <TD className="text-right text-[var(--good-text)]">−{money(h.base_face)}</TD><TD className="text-right">—</TD><TD />
                    </TR>
                  ))}
                  <TR className="bg-muted/40 font-medium">
                    <TD>Total</TD><TD /><TD className="text-right">{money(custom.holdings.reduce((a, h) => a + h.face, 0))}</TD><TD />
                    <TD className="text-right">{money(custom.cost)}</TD><TD />
                  </TR>
                </TBody>
              </Table>
            </div>
            <div className="xl:col-span-2">
              <Table>
                <THead><TR><TH>Payment</TH><TH className="text-right">Due</TH><TH className="text-right">Paid</TH><TH>Status</TH></TR></THead>
                <TBody>
                  {custom.schedule?.map((p) => (
                    <TR key={p.date}>
                      <TD>{date(p.date)}</TD>
                      <TD className="text-right">{money(p.required)}</TD>
                      <TD className="text-right">{money(p.paid)}</TD>
                      <TD>{p.shortfall > 0.5 ? <Badge variant="critical">{ratioPct(p.coverage, 0)}</Badge> : <Badge variant="good">Covered</Badge>}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              <div className="grid grid-cols-2 gap-y-1 border-t px-5 py-3 text-[12.5px]">
                <span className="text-muted-foreground">Modified duration</span><span className="text-right tnum">{num(custom.mod_dur)}</span>
                <span className="text-muted-foreground">Convexity</span><span className="text-right tnum">{num(custom.convexity, 1)}</span>
                <span className="text-muted-foreground">Bonds used</span><span className="text-right tnum">{custom.bonds_used}</span>
              </div>
            </div>
          </div>
        </ChartCard>
      )}

      <ChartCard title="Scenario comparison" description="Compared with the base allocation." contentClassName="p-0">
        <Table>
          <THead>
            <TR><TH>Scenario</TH><TH className="text-right">Cost</TH><TH className="text-right">Change</TH><TH className="text-right">Bonds</TH>
              <TH className="text-right">Coverage</TH><TH className="text-right">Mod. dur</TH><TH className="text-right">Convexity</TH><TH>What happens to today's portfolio</TH></TR>
          </THead>
          <TBody>
            {allSc.map((s) => (
              <TR key={s.name} className={s.name === "Custom scenario" ? "bg-primary/5" : ""}>
                <TD><div className="font-medium">{s.name}</div><div className="text-[11px] text-muted-foreground">{s.description}</div></TD>
                <TD className="text-right font-medium">{money(s.cost)}</TD>
                <TD className="text-right">{s.name === "Base case" ? "—" : `${pct(s.delta_pct, 2)}`}</TD>
                <TD className="text-right">{s.bonds_used ?? "—"}</TD>
                <TD className="text-right">{s.status === "infeasible" ? <Badge variant="critical">Infeasible</Badge> : ratioPct(s.min_coverage, 0)}</TD>
                <TD className="text-right">{num(s.mod_dur)}</TD>
                <TD className="text-right">{num(s.convexity, 1)}</TD>
                <TD className="whitespace-normal text-[12px] text-muted-foreground">{impact(s)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {base?.units && <QuantityTable scenarios={allSc} names={Object.fromEntries((r.universe ?? []).map((b) => [b.isin, b.description]))} />}
      </ChartCard>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard title="If liabilities turn out bigger or smaller" description="Cost of re-optimising for each size of schedule.">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={unc} margin={{ top: 20, right: 8, left: 0, bottom: 0 }} barCategoryGap="30%">
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="label" {...axisProps} />
              <YAxis {...axisProps} tickFormatter={axisCr} width={56} />
              <Tooltip cursor={{ fill: "hsl(var(--muted))", opacity: 0.5 }} content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload;
                return <TipBox title={`Liabilities ${d.label}`} rows={[{ label: "Liabilities", value: money(d.liability_total) }, { label: "Cost to cover", value: money(d.cost), strong: true }]} />;
              }} />
              <Bar dataKey="cost" radius={[4, 4, 0, 0]} maxBarSize={48}>
                {unc.map((d) => <Cell key={d.label} fill={d.factor === 1 ? "var(--chart-muted)" : S[0]} />)}
                <LabelList dataKey="cost" position="top" formatter={(v: number) => money(v)} style={{ fontSize: 10.5, fill: "hsl(var(--muted-foreground))" }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="How far today's portfolio stretches" description="Lowest payment coverage if you keep today's bonds and liabilities change.">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={unc} margin={{ top: 20, right: 8, left: 0, bottom: 0 }} barCategoryGap="30%">
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="label" {...axisProps} />
              <YAxis {...axisProps} domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} width={44} />
              <Tooltip cursor={{ fill: "hsl(var(--muted))", opacity: 0.5 }} content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload;
                return <TipBox title={`Liabilities ${d.label}`} rows={[{ label: "Lowest coverage", value: ratioPct(d.base_coverage, 0), strong: true }, { label: "Total shortfall", value: money(d.base_shortfall) }]} />;
              }} />
              <Bar dataKey="base_coverage" radius={[4, 4, 0, 0]} maxBarSize={48}>
                {unc.map((d) => <Cell key={d.label} fill={d.base_coverage >= 0.9999 ? S[0] : S[7]} />)}
                <LabelList dataKey="base_coverage" position="top" formatter={(v: number) => ratioPct(v, 0)} style={{ fontSize: 10.5, fill: "hsl(var(--muted-foreground))" }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
}

function impact(s: Scenario): string {
  if (s.base_value_change_pct != null) return `Market value ${pct(s.base_value_change_pct, 2)} to ${money(s.base_portfolio_value)}. ${s.note ?? ""}`;
  if (s.base_portfolio_coverage != null) {
    const who = s.base_without_removed ? "Without the unavailable bonds it " : "";
    return s.base_portfolio_coverage >= 0.9999 ? `${who || ""}${who ? "still covers" : "Still covers"} every payment.`
      : `${who}${who ? "covers" : "Covers"} ${ratioPct(s.base_portfolio_coverage, 0)} at worst; short ${money(s.base_portfolio_shortfall)} in total.`;
  }
  if (s.removed) return `Replaced ${s.removed}.`;
  if (s.name === "Base case") return "—";
  return s.message ?? "";
}

function SliderRow({ label, value, min, max, step, onChange, fmt }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt: (v: number) => string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between"><Label>{label}</Label><span className="text-xs font-medium tnum">{fmt(value)}</span></div>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={([v]) => onChange(v)} />
    </div>
  );
}

function QuantityTable({ scenarios, names }: { scenarios: Scenario[]; names: Record<string, string> }) {
  const isins = Array.from(new Set(scenarios.flatMap((s) => Object.keys(s.units ?? {}))));
  const base = scenarios[0]?.units ?? {};
  isins.sort((a, b) => (base[b] ?? 0) - (base[a] ?? 0));
  return (
    <div className="border-t">
      <div className="px-5 pb-1 pt-4 text-[13px] font-semibold">Face value bought, by scenario</div>
      <Table>
        <THead><TR><TH>Bond</TH>{scenarios.map((s) => <TH key={s.name} className="text-right">{s.name}</TH>)}</TR></THead>
        <TBody>
          {isins.map((i) => (
            <TR key={i}>
              <TD className="font-medium">{shortName(names[i] ?? i)}</TD>
              {scenarios.map((s) => {
                const v = s.units?.[i];
                const changed = s.name !== "Base case" && Math.abs((v ?? 0) - (base[i] ?? 0)) > 1;
                return <TD key={s.name} className={`text-right ${changed ? "font-medium" : "text-muted-foreground"}`}>{v ? money(v) : "—"}</TD>;
              })}
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
