import { Area, Bar, CartesianGrid, ComposedChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartCard, Legend, S, TipBox, axisProps, gridProps } from "@/components/charts";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { axisCr, date, money, monthLabel, num, ratioPct, shortName } from "@/lib/format";
import type { Result } from "@/lib/types";

export function CashFlowTab({ r }: { r: Result }) {
  const cal = (r.calendar ?? []).map((c) => ({ ...c, out: -c.payment, label: monthLabel(c.month) }));
  const sched = r.schedule ?? [];
  const m = r.matrix;
  const hasExisting = sched.some((s) => s.existing_cash > 1);
  return (
    <div className="space-y-4">
      <ChartCard title="Month-by-month cash calendar"
        description="Bond coupons and redemptions coming in, payments going out, and the cash balance waiting in between.">
        <Legend className="mb-3" items={[{ color: S[0], label: "Bond cash in" }, { color: S[1], label: "Payments out" }, { color: S[6], label: "Cash waiting (balance)" }]} />
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={cal} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} stackOffset="sign" barCategoryGap="12%">
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={24} />
            <YAxis {...axisProps} tickFormatter={axisCr} width={56} />
            <ReferenceLine y={0} stroke="var(--chart-axis)" />
            <Tooltip cursor={{ fill: "hsl(var(--muted))", opacity: 0.5 }} content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const c = payload[0].payload;
              return <TipBox title={c.label} rows={[
                { color: S[0], label: "Bond cash in", value: money(c.inflow) },
                { color: S[1], label: "Payments out", value: money(c.payment) },
                { color: S[6], label: "Balance after", value: money(c.balance), strong: true },
              ]} />;
            }} />
            <Area dataKey="balance" type="stepAfter" stroke={S[6]} strokeWidth={2} fill={S[6]} fillOpacity={0.08} isAnimationActive={false} />
            <Bar dataKey="inflow" fill={S[0]} radius={[4, 4, 0, 0]} maxBarSize={18} />
            <Bar dataKey="out" fill={S[1]} radius={[0, 0, 4, 4]} maxBarSize={18} />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Coverage at each payment date" description="Flow balance at every node: cash in + carried in = paid + carried out." contentClassName="p-0">
        <Table>
          <THead>
            <TR>
              <TH>Payment date</TH><TH className="text-right">Due</TH>
              {hasExisting && <TH className="text-right">Existing holdings</TH>}
              <TH className="text-right">New bond cash</TH><TH className="text-right">Carried in</TH>
              <TH className="text-right">Paid</TH><TH className="text-right">Carried out</TH><TH className="text-right">Shortfall</TH><TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {sched.map((s) => (
              <TR key={s.date}>
                <TD className="font-medium">{date(s.date)}</TD>
                <TD className="text-right">{money(s.required)}</TD>
                {hasExisting && <TD className="text-right">{money(s.existing_cash)}</TD>}
                <TD className="text-right">{money(s.bond_cash - s.existing_cash)}</TD>
                <TD className="text-right">{money(s.carried_in)}</TD>
                <TD className="text-right">{money(s.paid)}</TD>
                <TD className="text-right">{money(s.carried_out)}</TD>
                <TD className="text-right">{s.shortfall > 0.5 ? money(s.shortfall) : "—"}</TD>
                <TD>{s.shortfall > 0.5 ? <Badge variant="critical">{ratioPct(s.coverage, 0)} covered</Badge> : <Badge variant="good">Covered</Badge>}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </ChartCard>

      {m && m.rows.length > 0 && (
        <ChartCard title="Cash-flow matrix CFᵢ,ₜ" description="Cash per ₹100 face that each selected bond delivers to each payment date (coupons and redemption falling in that period)." contentClassName="p-0">
          <Table>
            <THead>
              <TR>
                <TH>Bond</TH>
                {m.dates.map((d) => <TH key={d} className="text-right">{date(d)}</TH>)}
              </TR>
            </THead>
            <TBody>
              {m.rows.map((row) => (
                <TR key={row.isin}>
                  <TD className="font-medium">{shortName(row.description)}</TD>
                  {row.cf.map((v, i) => (
                    <TD key={i} className="text-right" style={{ background: v > 0 ? `color-mix(in srgb, ${S[0]} ${Math.min(36, 6 + v / 4)}%, transparent)` : undefined }}>
                      {v > 0 ? num(v, 2) : <span className="text-muted-foreground/50">·</span>}
                    </TD>
                  ))}
                </TR>
              ))}
            </TBody>
          </Table>
        </ChartCard>
      )}
    </div>
  );
}
