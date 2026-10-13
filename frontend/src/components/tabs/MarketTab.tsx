import * as React from "react";
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { ArrowUpDown, Search } from "lucide-react";
import { ChartCard, Legend, S, TipBox, axisProps, gridProps } from "@/components/charts";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { date, money, num, pct, shortName } from "@/lib/format";
import type { Bond, Result } from "@/lib/types";

const CAT_COLOR: Record<string, string> = { "G-Sec": S[0], "T-Bill": S[1], SDL: S[2] };

export function MarketTab({ r, onExclude }: { r: Result; onExclude: (isin: string) => void }) {
  const cats = Array.from(new Set(r.curve.points.map((p) => p.category)));
  const selected = new Set((r.holdings ?? []).map((h) => h.isin));
  return (
    <div className="space-y-4">
      <ChartCard title="Yield curve of eligible bonds"
        description={`Each dot is a bond's CCIL weighted-average yield (size = traded volume). The line is a Nelson–Siegel zero curve fitted to their prices (RMSE ${num(r.curve.rmse_bp, 1)} bp); it values the liabilities.`}>
        <Legend className="mb-3" items={[...cats.map((c) => ({ color: CAT_COLOR[c] ?? S[3], label: c })), { color: "hsl(var(--foreground))", label: "Fitted zero curve", line: true }]} />
        <ResponsiveContainer width="100%" height={340}>
          <ComposedChart margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="years" type="number" {...axisProps} domain={[0, (m: number) => Math.ceil(m / 5) * 5]} tickFormatter={(v) => `${Math.round(v)}y`} tickCount={8} allowDuplicatedCategory={false} />
            <YAxis type="number" {...axisProps} domain={["auto", "auto"]} tickFormatter={(v) => `${v}%`} width={44} />
            <ZAxis dataKey="volume" range={[56, 420]} />
            <Tooltip cursor={{ strokeDasharray: "3 3" }} content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload;
              if (d.rate != null) return <TipBox title={`${num(d.years, 1)} years`} rows={[{ label: "Zero rate", value: pct(d.rate, 2), strong: true }]} />;
              return <TipBox title={shortName(d.description)} rows={[
                { color: CAT_COLOR[d.category], label: d.category, value: `${num(d.years, 2)} yrs` },
                { label: "CCIL yield", value: pct(d.ytm, 2), strong: true },
                { label: "Day volume", value: money((d.volume ?? 0) * 1e7) },
              ]} footer={selected.has(d.isin) ? "In your portfolio" : undefined} />;
            }} />
            {cats.map((c) => (
              <Scatter key={c} name={c} data={r.curve.points.filter((p) => p.category === c).map((p) => ({ ...p, ytm: p.ytm ?? p.yield }))}
                dataKey="ytm" fill={CAT_COLOR[c] ?? S[3]} fillOpacity={0.75} stroke="var(--chart-surface)" strokeWidth={1.5} />
            ))}
            <Line data={r.curve.fitted} dataKey="rate" stroke="hsl(var(--foreground))" strokeWidth={2} dot={false} type="monotone" isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartCard>

      <BondTable title={`Eligible bonds (${r.universe.length})`} rows={r.universe} selected={selected} onExclude={onExclude} />

      <ChartCard title={`Excluded securities (${r.excluded.length})`} description="Left out because their cash flows aren't fixed, or because of your filters." contentClassName="p-0">
        <div className="max-h-96 overflow-auto scroll-thin">
          <Table>
            <THead className="sticky top-0"><TR><TH>Security</TH><TH>Type</TH><TH>Maturity</TH><TH className="text-right">Price</TH><TH>Reason</TH></TR></THead>
            <TBody>
              {r.excluded.map((x) => (
                <TR key={x.isin}>
                  <TD className="font-medium">{x.description}<div className="text-[11px] text-muted-foreground">{x.isin}</div></TD>
                  <TD>{x.category}</TD><TD>{date(x.maturity)}</TD><TD className="text-right">{num(x.price)}</TD>
                  <TD className="whitespace-normal text-muted-foreground">{x.reason}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      </ChartCard>
    </div>
  );
}

type SortKey = keyof Pick<Bond, "maturity" | "coupon" | "price" | "ytm" | "mod_dur" | "volume" | "trades" | "price_check">;

function BondTable({ title, rows, selected, onExclude }: { title: string; rows: Bond[]; selected: Set<string>; onExclude: (i: string) => void }) {
  const [q, setQ] = React.useState("");
  const [sort, setSort] = React.useState<{ key: SortKey; dir: 1 | -1 }>({ key: "maturity", dir: 1 });
  const shown = rows
    .filter((b) => !q || `${b.description} ${b.isin} ${b.category}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => {
      const x = a[sort.key], y = b[sort.key];
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  const H = ({ k, children }: { k: SortKey; children: React.ReactNode }) => (
    <TH className="text-right">
      <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? (-s.dir as 1 | -1) : 1 }))}>
        {children}<ArrowUpDown className="h-3 w-3 opacity-50" />
      </button>
    </TH>
  );
  return (
    <ChartCard title={title} description="Validation: 'Price check' reprices each bond from CCIL's own yield with our cash flows. Near zero means the coupon schedule and day count are right."
      right={<div className="relative w-56"><Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search bonds" className="pl-8" /></div>}
      contentClassName="p-0">
      <div className="max-h-[480px] overflow-auto scroll-thin">
        <Table>
          <THead className="sticky top-0 z-10">
            <TR>
              <TH>Security</TH><H k="maturity">Maturity</H><H k="coupon">Coupon</H><H k="price">Clean</H>
              <TH className="text-right">Dirty</TH><H k="ytm">CCIL yield</H><H k="mod_dur">Mod. dur</H><H k="volume">Volume</H><H k="trades">Trades</H><H k="price_check">Price check</H><TH />
            </TR>
          </THead>
          <TBody>
            {shown.map((b) => (
              <TR key={b.isin}>
                <TD>
                  <div className="flex items-center gap-1.5 font-medium">{shortName(b.description)}{selected.has(b.isin) && <Badge>bought</Badge>}</div>
                  <div className="text-[11px] text-muted-foreground">{b.isin} · {b.kind}</div>
                </TD>
                <TD className="text-right">{date(b.maturity)}</TD>
                <TD className="text-right">{b.category === "T-Bill" ? "zero" : pct(b.coupon, 2)}</TD>
                <TD className="text-right">{num(b.price)}</TD>
                <TD className="text-right">{num(b.dirty, 3)}</TD>
                <TD className="text-right">{pct(b.ytm, 2)}</TD>
                <TD className="text-right">{num(b.mod_dur)}</TD>
                <TD className="text-right">{money((b.volume ?? 0) * 1e7, 1)}</TD>
                <TD className="text-right">{b.trades}</TD>
                <TD className="text-right text-muted-foreground">{num(b.price_check, 3)}</TD>
                <TD><button className="text-[11px] text-muted-foreground hover:text-[var(--status-critical)]" onClick={() => onExclude(b.isin)}>exclude</button></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
    </ChartCard>
  );
}
