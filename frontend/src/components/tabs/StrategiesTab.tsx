import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CheckCircle2, Trophy, XCircle } from "lucide-react";
import { ChartCard, S, TipBox, axisProps, gridProps } from "@/components/charts";
import { Badge } from "@/components/ui/badge";
import { money, num, pct, ratioPct, shortName } from "@/lib/format";
import type { Result } from "@/lib/types";
import { cn } from "@/lib/utils";

export function StrategiesTab({ r }: { r: Result }) {
  const st = r.strategies ?? [];
  const best = st[0]?.cost ?? 0;
  const c = r.constraints;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        {st.map((s, i) => {
          const ok = (s.min_coverage ?? 0) >= 0.9999;
          return (
            <div key={s.name} className={cn("rounded-xl border bg-card p-5 shadow-sm", i === 0 && "ring-2 ring-primary/40")}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1.5 text-[15px] font-semibold">{i === 0 && <Trophy className="h-4 w-4 text-primary" />}{s.name}</div>
                  <div className="mt-0.5 text-[12.5px] text-muted-foreground">{s.note}</div>
                </div>
                {s.available && (ok ? <Badge variant="good"><CheckCircle2 /> Pays all</Badge> : <Badge variant="critical"><XCircle /> Gaps</Badge>)}
              </div>
              {s.available ? (
                <>
                  <div className="mt-4 text-[26px] font-semibold tracking-tight tnum">{money(s.cost)}</div>
                  <div className="text-[12px] text-muted-foreground">{i === 0 ? "lowest cost with no gaps" : `${(s.cost ?? 0) >= best ? "+" : ""}${money((s.cost ?? 0) - best)} vs optimised (${pct(((s.cost ?? 0) / best - 1) * 100, 2)})`}</div>
                  <div className="mt-4 grid grid-cols-2 gap-y-1.5 text-[12.5px]">
                    <span className="text-muted-foreground">Bonds</span><span className="text-right tnum">{s.bonds_used}</span>
                    <span className="text-muted-foreground">Lowest coverage</span><span className="text-right tnum">{ratioPct(s.min_coverage, 0)}</span>
                    <span className="text-muted-foreground">Cash gaps (held to maturity)</span><span className="text-right tnum">{money(s.shortfall)}</span>
                    <span className="text-muted-foreground">Cash left at the end</span><span className="text-right tnum">{money(s.leftover)}</span>
                    <span className="text-muted-foreground">Modified duration</span><span className="text-right tnum">{num(s.mod_dur)}</span>
                  </div>
                  <div className="mt-3 border-t pt-3 text-[11.5px] text-muted-foreground">
                    {s.holdings?.map((h) => shortName(h.description)).join(" · ")}
                  </div>
                </>
              ) : <div className="mt-4 text-sm text-muted-foreground">Not available for this schedule.</div>}
            </div>
          );
        })}
      </div>
      <p className="text-[12.5px] leading-relaxed text-muted-foreground">
        Duration matching looks cheaper because it only buys the liabilities' present value. Its bonds don't pay cash on the payment dates, so it has to
        sell bonds at whatever price the market offers then, and it must be rebalanced as rates move. Cash-flow matching pays a little more for certainty.
      </p>

      {c && (
        <div className="grid gap-4 xl:grid-cols-2">
          <ChartCard title="Cost of a per-bond limit" description="Minimum cost as the maximum share in any one bond tightens.">
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={[...c.max_weight].reverse()} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="limit" {...axisProps} tickFormatter={(v) => (v === 100 ? "none" : `${v}%`)} />
                <YAxis {...axisProps} tickFormatter={(v) => `${(v / 1e7).toFixed(3)} cr`} width={68} domain={["auto", "auto"]} />
                <Tooltip content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload;
                  return <TipBox title={d.limit === 100 ? "No limit" : `Max ${d.limit}% in one bond`} rows={[
                    { color: S[0], label: "Cost", value: d.cost ? money(d.cost) : "infeasible", strong: true },
                    { label: "Extra vs no limit", value: d.cost ? money(d.cost - (c.max_weight[0].cost ?? 0)) : "—" },
                  ]} />;
                }} />
                <Line dataKey="cost" stroke={S[0]} strokeWidth={2} dot={{ r: 4, fill: S[0], stroke: "var(--chart-surface)", strokeWidth: 2 }} activeDot={{ r: 5 }} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
          <ChartCard title="Cost of a liquidity filter" description="Minimum cost when only bonds with at least this day volume are allowed.">
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={c.min_volume} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="limit" {...axisProps} tickFormatter={(v) => (v === 0 ? "any" : `₹${v} cr`)} />
                <YAxis {...axisProps} tickFormatter={(v) => `${(v / 1e7).toFixed(3)} cr`} width={68} domain={["auto", "auto"]} />
                <Tooltip content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload;
                  return <TipBox title={d.limit === 0 ? "Any volume" : `Volume ≥ ₹${d.limit} cr`} rows={[
                    { color: S[0], label: "Cost", value: d.cost ? money(d.cost) : "infeasible", strong: true },
                    { label: "Bonds allowed", value: d.bonds },
                  ]} />;
                }} />
                <Line dataKey="cost" stroke={S[0]} strokeWidth={2} dot={{ r: 4, fill: S[0], stroke: "var(--chart-surface)", strokeWidth: 2 }} activeDot={{ r: 5 }} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      )}
    </div>
  );
}
