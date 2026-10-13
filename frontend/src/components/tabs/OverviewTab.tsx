import * as React from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Sankey, Tooltip, XAxis, YAxis } from "recharts";
import { ChartCard, Legend, S, TipBox, axisProps, gridProps } from "@/components/charts";
import { axisCr, date, money, num, ratioPct, shortName } from "@/lib/format";
import type { Result } from "@/lib/types";

export function CoverageChart({ r, height = 300 }: { r: Result; height?: number }) {
  const hasExisting = (r.schedule ?? []).some((s) => s.existing_cash > 1);
  const data = (r.schedule ?? []).map((s) => ({
    label: date(s.date), new_cash: s.bond_cash - s.existing_cash, existing: s.existing_cash,
    carried: s.carried_in, required: s.required, row: s,
  }));
  const items = [
    { color: S[0], label: "New bond cash" },
    ...(hasExisting ? [{ color: S[2], label: "Existing holdings" }] : []),
    { color: S[6], label: "Carried in from earlier" },
    { color: "hsl(var(--foreground))", label: "Payment due", line: true },
  ];
  return (
    <>
      <Legend items={items} className="mb-3" />
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="28%">
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="label" {...axisProps} />
          <YAxis {...axisProps} tickFormatter={axisCr} width={56} />
          <Tooltip cursor={{ fill: "hsl(var(--muted))", opacity: 0.5 }} content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const s = payload[0].payload.row;
            return <TipBox title={date(s.date)} rows={[
              { color: S[0], label: "New bond cash", value: money(s.bond_cash - s.existing_cash) },
              ...(hasExisting ? [{ color: S[2], label: "Existing holdings", value: money(s.existing_cash) }] : []),
              { color: S[6], label: "Carried in", value: money(s.carried_in) },
              { label: "Payment due", value: money(s.required), strong: true },
              { label: "Carried forward", value: money(s.carried_out) },
            ]} footer={s.shortfall > 0.5 ? `Short by ${money(s.shortfall)}` : `Covered ${ratioPct(s.coverage, 0)}`} />;
          }} />
          <Bar dataKey="new_cash" stackId="a" fill={S[0]} stroke="var(--chart-surface)" strokeWidth={2} />
          {hasExisting && <Bar dataKey="existing" stackId="a" fill={S[2]} stroke="var(--chart-surface)" strokeWidth={2} />}
          <Bar dataKey="carried" stackId="a" fill={S[6]} stroke="var(--chart-surface)" strokeWidth={2} radius={[4, 4, 0, 0]} />
          <Line dataKey="required" type="linear" stroke="hsl(var(--foreground))" strokeWidth={0} isAnimationActive={false}
            dot={(p: { cx?: number; cy?: number; index?: number }) => (
              <line key={p.index} x1={(p.cx ?? 0) - 22} x2={(p.cx ?? 0) + 22} y1={p.cy} y2={p.cy} stroke="hsl(var(--foreground))" strokeWidth={2.5} strokeLinecap="round" />
            )} activeDot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </>
  );
}

const KIND_COLOR: Record<string, string> = { bond: S[0], date: "hsl(var(--foreground))", sink: S[2] };

function SankeyNode(props: { x?: number; y?: number; width?: number; height?: number; index?: number; payload?: { name: string; kind: string; value: number }; containerWidth?: number }) {
  const { x = 0, y = 0, width = 0, height = 0, payload } = props;
  if (!payload) return null;
  const isLeft = payload.kind === "bond";
  const isSink = payload.kind === "sink";
  const fill = KIND_COLOR[payload.kind] ?? S[0];
  return (
    <g>
      <rect x={x} y={y} width={width} height={Math.max(height, 2)} rx={2} fill={fill} opacity={payload.kind === "date" ? 0.85 : 1} />
      <text x={isLeft ? x - 6 : isSink ? x + width + 6 : x + width / 2} y={isSink || isLeft ? y + height / 2 : y - 5}
        textAnchor={isLeft ? "end" : isSink ? "start" : "middle"} dominantBaseline={isSink || isLeft ? "middle" : "auto"}
        fontSize={11} fill="hsl(var(--foreground))">
        {shortName(payload.name)}
      </text>
      {(isLeft || isSink) && (
        <text x={isLeft ? x - 6 : x + width + 6} y={y + height / 2 + 13} textAnchor={isLeft ? "end" : "start"} fontSize={10} fill="var(--chart-muted)">
          {money(payload.value)}
        </text>
      )}
    </g>
  );
}

function SankeyLink(props: { sourceX?: number; targetX?: number; sourceY?: number; targetY?: number; sourceControlX?: number; targetControlX?: number; linkWidth?: number; payload?: { kind: string } }) {
  const { sourceX = 0, targetX = 0, sourceY = 0, targetY = 0, sourceControlX = 0, targetControlX = 0, linkWidth = 0, payload } = props;
  const color = payload?.kind === "carry" ? S[6] : payload?.kind === "pay" ? S[2] : S[0];
  return (
    <path d={`M${sourceX},${sourceY} C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
      fill="none" stroke={color} strokeOpacity={0.28} strokeWidth={Math.max(linkWidth, 1)} className="transition-[stroke-opacity] hover:[stroke-opacity:0.55]" />
  );
}

export function NetworkSankey({ r }: { r: Result }) {
  const data = React.useMemo(() => r.sankey ?? { nodes: [], links: [] }, [r.sankey]);
  if (!data.links.length) return <div className="py-10 text-center text-sm text-muted-foreground">No cash flows to draw</div>;
  const nBonds = data.nodes.filter((n) => n.kind === "bond").length;
  const h = Math.max(320, Math.max(nBonds, data.nodes.filter((n) => n.kind === "date").length) * 44);
  return (
    <>
      <Legend items={[{ color: S[0], label: "Bond cash → payment date" }, { color: S[6], label: "Carry arc (surplus to next date)" }, { color: S[2], label: "Paid out" }]} className="mb-2" />
      <ResponsiveContainer width="100%" height={h}>
        <Sankey data={data} sort={false} nodeWidth={10} nodePadding={26} linkCurvature={0.5} iterations={64}
          margin={{ top: 18, right: 150, bottom: 12, left: 170 }}
          node={<SankeyNode />} link={<SankeyLink />}>
          <Tooltip content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as { payload?: { source?: { name: string }; target?: { name: string }; value: number; kind?: string; name?: string } };
            const d = p.payload;
            if (!d) return null;
            if (d.source && d.target) {
              return <TipBox title={d.kind === "carry" ? "Carried forward" : d.kind === "pay" ? "Paid out" : "Bond cash"}
                rows={[{ label: `${shortName(d.source.name)} → ${shortName(d.target.name)}`, value: money(d.value), strong: true }]} />;
            }
            return <TipBox title={shortName(d.name ?? "")} rows={[{ label: "Flow", value: money(d.value), strong: true }]} />;
          }} />
        </Sankey>
      </ResponsiveContainer>
    </>
  );
}

export function OverviewTab({ r }: { r: Result }) {
  const s = r.summary!;
  const premium = s.liability_pv ? (s.cost / s.liability_pv - 1) * 100 : 0;
  return (
    <div className="grid gap-4 xl:grid-cols-5">
      <ChartCard className="xl:col-span-3" title="Cash available vs payment due"
        description="Each bar is the cash reaching a payment date; the black tick is the amount due.">
        <CoverageChart r={r} />
      </ChartCard>
      <div className="grid gap-4 xl:col-span-2">
        {s.covered_all ? (
          <Insight title="Price of certainty" value={`${num(premium, 2)}%`}
            text={`You pay ${money(s.cost)} against ${money(s.liability_pv)} of liabilities' market value. The extra buys exact timing: no bond ever has to be sold before maturity.`} />
        ) : (
          <Insight title="Budget stretch" value={ratioPct(1 - s.shortfall / s.required_total, 0)}
            text={`${money(s.cost)} covers the earliest payments first. Covering everything would take roughly ${money(s.cost + s.shortfall * (s.liability_pv / s.required_total))} in total.`} />
        )}
        <Insight title="Interest-rate exposure" value={`${num(s.portfolio_mod_dur - s.liability_mod_dur, 2)} yrs`}
          text={`Portfolio duration ${num(s.portfolio_mod_dur)} vs liabilities ${num(s.liability_mod_dur)}. Held to maturity, rate moves don't affect the payments; only the market value moves.`} />
        <Insight title="Where the money goes" value={`${s.bonds_used} bonds`}
          text={(r.holdings ?? []).slice().sort((a, b) => b.cost - a.cost).slice(0, 3).map((h) => `${shortName(h.description)} ${ratioPct(h.weight, 0)}`).join(" · ")} />
      </div>
      <ChartCard className="xl:col-span-5" title="The cash-flow network"
        description="Bonds send coupons and redemptions to the next payment date; surplus moves along carry arcs to the following date. This is the network the optimiser solves.">
        <NetworkSankey r={r} />
      </ChartCard>
    </div>
  );
}

function Insight({ title, value, text }: { title: string; value: string; text: string }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[13px] font-semibold">{title}</div>
        <div className="text-lg font-semibold tracking-tight tnum">{value}</div>
      </div>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">{text}</p>
    </div>
  );
}
