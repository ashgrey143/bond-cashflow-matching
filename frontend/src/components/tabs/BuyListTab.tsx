import { Ban, Download, FileSpreadsheet } from "lucide-react";
import { ChartCard, S } from "@/components/charts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Hint } from "@/components/ui/tooltip";
import { date, inr, money, num, pct, ratioPct, shortName } from "@/lib/format";
import type { Result } from "@/lib/types";

export function BuyListTab({ r, onExclude, onDownload }: { r: Result; onExclude: (isin: string) => void; onDownload: (k: "xlsx" | "buy-order") => void }) {
  const h = r.holdings ?? [];
  const total = h.reduce((s, x) => s + x.cost, 0);
  const byCost = [...h].sort((a, b) => b.cost - a.cost);
  // seven colours in fixed order, then everything else folds into "Other"
  const top = byCost.slice(0, byCost.length > 8 ? 7 : 8);
  const rest = byCost.slice(top.length);
  const segs = [
    ...top.map((x, i) => ({ key: x.isin, label: shortName(x.description), cost: x.cost, weight: x.weight, color: S[i] })),
    ...(rest.length ? [{ key: "other", label: `Other (${rest.length} bonds)`, cost: rest.reduce((a, x) => a + x.cost, 0),
      weight: rest.reduce((a, x) => a + x.weight, 0), color: "var(--chart-muted)" }] : []),
  ];
  return (
    <div className="space-y-4">
      <ChartCard title="Allocation" description="Share of the investment in each bond"
        right={<div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => onDownload("buy-order")}><Download /> Buy order (CSV)</Button>
          <Button size="sm" onClick={() => onDownload("xlsx")}><FileSpreadsheet /> Committee report</Button>
        </div>}>
        <div className="flex h-9 w-full overflow-hidden rounded-md">
          {segs.map((x) => (
            <div key={x.key} title={`${x.label}: ${ratioPct(x.weight)}`}
              className="h-full border-r-2 border-[var(--chart-surface)] last:border-r-0"
              style={{ width: `${x.weight * 100}%`, background: x.color }} />
          ))}
        </div>
        <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2 lg:grid-cols-3">
          {segs.map((x) => (
            <div key={x.key} className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: x.color }} />
                <span className="truncate">{x.label}</span>
              </span>
              <span className="tnum text-muted-foreground">{money(x.cost)} · {ratioPct(x.weight, 1)}</span>
            </div>
          ))}
        </div>
      </ChartCard>

      <ChartCard title="Buy list" description={`${h.length} bonds · ${money(total)} at dirty price${r.options.tx_cost_bp ? ` + ${r.options.tx_cost_bp} bp cost` : ""} · settlement ${date(r.settle)}`} contentClassName="p-0">
        <Table>
          <THead>
            <TR>
              <TH>Security</TH><TH>Maturity</TH><TH className="text-right">Face value</TH>
              {r.options.lot_face > 0 && <TH className="text-right">Lots</TH>}
              <TH className="text-right">Clean</TH><TH className="text-right">Accrued</TH><TH className="text-right">Dirty</TH>
              <TH className="text-right">Cost</TH><TH className="text-right">Yield</TH><TH className="text-right">Mod. dur</TH>
              <TH className="text-right"><span className="inline-flex items-center gap-1">Order / day volume <Hint>Your face value as a share of what traded on the day. Above 25% the price may move against you; above 100% the order is bigger than the whole day's market.</Hint></span></TH>
              <TH>Liquidity</TH><TH />
            </TR>
          </THead>
          <TBody>
            {h.map((x) => (
              <TR key={x.isin}>
                <TD>
                  <div className="font-medium">{shortName(x.description)}</div>
                  <div className="text-[11px] text-muted-foreground">{x.isin} · {x.category}</div>
                </TD>
                <TD>{date(x.maturity)}</TD>
                <TD className="text-right font-medium">{money(x.face)}</TD>
                {r.options.lot_face > 0 && <TD className="text-right">{inr(x.lots ?? 0)}</TD>}
                <TD className="text-right">{num(x.clean)}</TD>
                <TD className="text-right">{num(x.accrued, 3)}</TD>
                <TD className="text-right">{num(x.dirty, 3)}</TD>
                <TD className="text-right font-medium">{money(x.cost)}</TD>
                <TD className="text-right">{pct(x.yield, 2)}</TD>
                <TD className="text-right">{num(x.mod_dur)}</TD>
                <TD className="text-right">
                  <div>{x.order_pct_volume == null ? "no volume" : pct(x.order_pct_volume, 1)}</div>
                  <div className="text-[11px] text-muted-foreground">{x.trades} trades · {money((x.volume ?? 0) * 1e7, 0)}{x.stale_days > 0 ? ` · ${x.stale_days}d old` : ""}</div>
                </TD>
                <TD>
                  <Badge variant={x.liquidity === "OK" ? "good" : x.liquidity === "Watch" ? "warn" : "critical"}>{x.liquidity}</Badge>
                </TD>
                <TD>
                  <Button size="icon-sm" variant="ghost" title="Exclude this bond and re-optimise" onClick={() => onExclude(x.isin)}>
                    <Ban className="text-muted-foreground" />
                  </Button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </ChartCard>
    </div>
  );
}
