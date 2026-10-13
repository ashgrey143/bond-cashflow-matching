import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ShieldCheck } from "lucide-react";
import { ChartCard, Legend, S, Stat, TipBox, axisProps, gridProps } from "@/components/charts";
import { Alert } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { axisCr, money, num, pct } from "@/lib/format";
import type { Result } from "@/lib/types";

export function RiskTab({ r }: { r: Result }) {
  const p = r.risk!.portfolio, l = r.risk!.liabilities;
  const shock = r.shock ?? [];
  const bpLabel = (v: number) => `${v > 0 ? "+" : ""}${v} bp`;
  return (
    <div className="space-y-4">
      <Alert tone="good" title="Held to maturity, the payments are safe whatever rates do">
        The bonds' coupons and redemptions are fixed, so every payment is met regardless of interest rates. Rates only change the
        <i> market value</i> of the portfolio and of the liabilities, which matters for mark-to-market reporting and if you ever need to sell.
      </Alert>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Market value: portfolio vs liabilities" value={`${money(p.value)}`} sub={`liabilities ${money(l.pv)} on the G-Sec curve`} />
        <Stat label="Modified duration" value={`${num(p.mod_dur)} / ${num(l.mod_dur)}`} sub="portfolio / liabilities, in years" />
        <Stat label="Macaulay duration" value={`${num(p.mac_dur)} / ${num(l.mac_dur)}`} sub="weighted average time to cash" />
        <Stat icon={<ShieldCheck />} label="Convexity" value={`${num(p.convexity, 1)} / ${num(l.convexity, 1)}`} sub="portfolio / liabilities" />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard title="Value change under parallel rate shifts" description="Full repricing of the portfolio and the liabilities, % change from today.">
          <Legend className="mb-3" items={[{ color: S[0], label: "Portfolio", line: true }, { color: S[1], label: "Liabilities", line: true, dashed: true }]} />
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={shock} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="shift_bp" {...axisProps} tickFormatter={bpLabel} type="number" domain={["dataMin", "dataMax"]} ticks={[-200, -100, 0, 100, 200]} />
              <YAxis {...axisProps} tickFormatter={(v) => `${v}%`} width={44} />
              <ReferenceLine x={0} stroke="var(--chart-axis)" />
              <ReferenceLine y={0} stroke="var(--chart-axis)" />
              <Tooltip content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload;
                return <TipBox title={`Rates ${bpLabel(d.shift_bp)}`} rows={[
                  { color: S[0], label: "Portfolio", value: `${pct(d.change_pct, 2)} · ${money(d.portfolio_value)}` },
                  { color: S[1], label: "Liabilities", value: `${pct(d.liability_change_pct, 2)} · ${money(d.liability_pv)}`, dashed: true },
                  { label: "Surplus (value − liabilities)", value: money(d.surplus), strong: true },
                ]} />;
              }} />
              <Line dataKey="change_pct" stroke={S[0]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              <Line dataKey="liability_change_pct" stroke={S[1]} strokeWidth={2} strokeDasharray="6 4" dot={false} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Duration and convexity as estimates" description="How well the duration and duration + convexity approximations track the portfolio's actual repricing.">
          <Legend className="mb-3" items={[{ color: S[0], label: "Actual (full repricing)", line: true }, { color: S[2], label: "Duration only", line: true, dashed: true }, { color: S[6], label: "Duration + convexity", line: true, dashed: true }]} />
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={shock} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="shift_bp" {...axisProps} tickFormatter={bpLabel} type="number" domain={["dataMin", "dataMax"]} ticks={[-200, -100, 0, 100, 200]} />
              <YAxis {...axisProps} tickFormatter={(v) => `${v}%`} width={44} />
              <ReferenceLine x={0} stroke="var(--chart-axis)" />
              <Tooltip content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload;
                return <TipBox title={`Rates ${bpLabel(d.shift_bp)}`} rows={[
                  { color: S[0], label: "Actual", value: pct(d.change_pct, 3), strong: true },
                  { color: S[2], label: "Duration only", value: pct(d.duration_est_pct, 3), dashed: true },
                  { color: S[6], label: "Duration + convexity", value: pct(d.dur_conv_est_pct, 3), dashed: true },
                ]} footer={`Convexity error fixed: ${pct(Math.abs(d.change_pct - d.duration_est_pct) - Math.abs(d.change_pct - d.dur_conv_est_pct), 3)}`} />;
              }} />
              <Line dataKey="change_pct" stroke={S[0]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              <Line dataKey="duration_est_pct" stroke={S[2]} strokeWidth={2} strokeDasharray="6 4" dot={false} activeDot={{ r: 4 }} />
              <Line dataKey="dur_conv_est_pct" stroke={S[6]} strokeWidth={2} strokeDasharray="2 3" dot={false} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Surplus at market value" description="Portfolio market value minus liabilities' present value after each shift (mark-to-market funded status).">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={shock} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="shift_bp" {...axisProps} tickFormatter={bpLabel} interval={1} />
              <YAxis {...axisProps} tickFormatter={axisCr} width={56} />
              <ReferenceLine y={0} stroke="var(--chart-axis)" />
              <Tooltip cursor={{ fill: "hsl(var(--muted))", opacity: 0.5 }} content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload;
                return <TipBox title={`Rates ${bpLabel(d.shift_bp)}`} rows={[{ label: "Surplus", value: money(d.surplus), strong: true }]} />;
              }} />
              <Bar dataKey="surplus" radius={[4, 4, 4, 4]} maxBarSize={22}>
                {shock.map((d) => <Cell key={d.shift_bp} fill={d.surplus >= 0 ? S[0] : S[7]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Repricing table" contentClassName="p-0">
          <Table>
            <THead><TR><TH>Shift</TH><TH className="text-right">Portfolio</TH><TH className="text-right">Change</TH><TH className="text-right">Liabilities PV</TH><TH className="text-right">Change</TH><TH className="text-right">Surplus</TH></TR></THead>
            <TBody>
              {shock.filter((d) => d.shift_bp % 50 === 0).map((d) => (
                <TR key={d.shift_bp} className={d.shift_bp === 0 ? "bg-muted/40 font-medium" : ""}>
                  <TD>{bpLabel(d.shift_bp)}</TD>
                  <TD className="text-right">{money(d.portfolio_value)}</TD>
                  <TD className="text-right">{pct(d.change_pct, 2)}</TD>
                  <TD className="text-right">{money(d.liability_pv)}</TD>
                  <TD className="text-right">{pct(d.liability_change_pct, 2)}</TD>
                  <TD className="text-right">{money(d.surplus)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </ChartCard>
      </div>
    </div>
  );
}
