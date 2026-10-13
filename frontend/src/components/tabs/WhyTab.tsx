import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartCard, S, TipBox, axisProps, gridProps } from "@/components/charts";
import { Alert } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { date, num, pct, shortName } from "@/lib/format";
import type { Result } from "@/lib/types";

export function WhyTab({ r }: { r: Result }) {
  const duals = r.duals ?? [];
  const reduced = r.reduced ?? [];
  if (!duals.length) {
    return <Alert tone="info" title="Shadow prices need a fully covered schedule">They come from the LP when every payment can be met. Loosen the budget or filters to see them.</Alert>;
  }
  const data = duals.map((d) => ({ label: date(d.date), paise: d.shadow_price * 100, ...d }));
  const unused = reduced.filter((x) => !x.selected).sort((a, b) => a.needed_drop_pct - b.needed_drop_pct).slice(0, 15);
  const chosen = reduced.filter((x) => x.selected);
  const priciest = [...duals].sort((a, b) => (b.implied_rate ?? 0) - (a.implied_rate ?? 0))[0];
  const cheapest = [...duals].sort((a, b) => (a.implied_rate ?? 0) - (b.implied_rate ?? 0))[0];

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <ChartCard title="What ₹1 owed on each date costs today"
        description="The LP's shadow price for each payment date, in paise: the extra cost of needing one more rupee then.">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data} margin={{ top: 20, right: 8, left: 0, bottom: 0 }} barCategoryGap="30%">
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="label" {...axisProps} />
            <YAxis {...axisProps} domain={[0, 100]} tickFormatter={(v) => `${v}p`} width={40} />
            <Tooltip cursor={{ fill: "hsl(var(--muted))", opacity: 0.5 }} content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload;
              return <TipBox title={d.label} rows={[
                { color: S[0], label: "Cost today of ₹1 due", value: `₹${num(d.shadow_price, 4)}`, strong: true },
                { label: "Implied rate", value: pct(d.implied_rate, 2) },
                { label: "Years away", value: num(d.years, 2) },
              ]} />;
            }} />
            <Bar dataKey="paise" fill={S[0]} radius={[4, 4, 0, 0]} maxBarSize={56}>
              <LabelList dataKey="paise" position="top" formatter={(v: number) => `${num(v, 1)}p`} style={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">
          The cheapest payment to fund is {date(priciest?.date)} (money grows at an implied {pct(priciest?.implied_rate, 2)} a year until then);
          the dearest is {date(cheapest?.date)} ({pct(cheapest?.implied_rate, 2)}). Rates differ because only bonds paying cash before each date can
          fund it, and cash waiting for a payment earns just {pct(r.options.reinvest_rate, 2)}.
        </p>
      </ChartCard>

      <ChartCard title="Why these bonds were picked" description="Value of the cash each bond delivers (priced with the shadow prices) per rupee paid. Selected bonds are worth exactly ₹1 per ₹1." contentClassName="p-0">
        <Table>
          <THead><TR><TH>Selected bond</TH><TH>Maturity</TH><TH className="text-right">Yield</TH><TH className="text-right">Value per ₹1</TH></TR></THead>
          <TBody>
            {chosen.map((x) => (
              <TR key={x.isin}>
                <TD className="font-medium">{shortName(x.description)}</TD>
                <TD>{date(x.maturity)}</TD>
                <TD className="text-right">{pct(x.yield, 2)}</TD>
                <TD className="text-right"><Badge variant="good">₹{num(x.value_ratio, 3)}</Badge></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </ChartCard>

      <ChartCard className="xl:col-span-2" title="Bonds that just missed out"
        description="How much cheaper each unused bond would have to be before the optimiser would buy it (the LP's reduced cost)." contentClassName="p-0">
        <Table>
          <THead>
            <TR><TH>Bond</TH><TH>Maturity</TH><TH className="text-right">Dirty price</TH><TH className="text-right">Yield</TH>
              <TH className="text-right">Value per ₹1</TH><TH className="text-right">Needs to be cheaper by</TH><TH className="w-[30%]" /></TR>
          </THead>
          <TBody>
            {unused.map((x) => (
              <TR key={x.isin}>
                <TD className="font-medium">{shortName(x.description)}<div className="text-[11px] text-muted-foreground">{x.isin}</div></TD>
                <TD>{date(x.maturity)}</TD>
                <TD className="text-right">{num(x.dirty, 3)}</TD>
                <TD className="text-right">{pct(x.yield, 2)}</TD>
                <TD className="text-right">₹{num(x.value_ratio, 3)}</TD>
                <TD className="text-right font-medium">₹{num(x.reduced_cost, 3)} ({pct(x.needed_drop_pct, 2)})</TD>
                <TD>
                  <div className="h-1.5 w-full rounded-full bg-muted">
                    <div className="h-1.5 rounded-full" style={{ width: `${Math.min(100, x.needed_drop_pct * 25)}%`, background: S[1] }} />
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </ChartCard>
    </div>
  );
}
