import { AlertTriangle, CheckCircle2, Clock, Coins, Gauge, Layers, PiggyBank, TrendingDown, XCircle } from "lucide-react";
import { Stat } from "@/components/charts";
import { Hint } from "@/components/ui/tooltip";
import { date, money, num, pct, ratioPct } from "@/lib/format";
import type { Result } from "@/lib/types";
import { cn } from "@/lib/utils";

export function SummaryHero({ r }: { r: Result }) {
  const s = r.summary!;
  const ok = s.covered_all;
  const firstGap = r.schedule?.find((x) => x.shortfall > 0.5);
  return (
    <div className={cn(
      "relative overflow-hidden rounded-xl border p-5 shadow-sm",
      ok ? "border-[color-mix(in_srgb,var(--status-good)_35%,transparent)] bg-[color-mix(in_srgb,var(--status-good)_6%,hsl(var(--card)))]"
        : "border-[color-mix(in_srgb,var(--status-warning)_50%,transparent)] bg-[color-mix(in_srgb,var(--status-warning)_8%,hsl(var(--card)))]",
    )}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex gap-3.5">
          <div className={cn("mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
            ok ? "bg-[color-mix(in_srgb,var(--status-good)_16%,transparent)]" : "bg-[color-mix(in_srgb,var(--status-warning)_22%,transparent)]")}>
            {ok ? <CheckCircle2 className="h-5 w-5 text-[var(--status-good)]" /> : <AlertTriangle className="h-5 w-5 text-[var(--status-warning)]" />}
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{ok ? "All payments covered" : "Not fully covered"}</div>
            <h2 className="mt-1 text-lg font-semibold leading-snug tracking-tight lg:text-xl">
              {ok ? (
                <>All {s.payments} payments ({money(s.required_total)}) are covered for <span className="text-primary">{money(s.cost)}</span> today, using {s.bonds_used} bonds.</>
              ) : (
                <>{money(s.cost)} covers {ratioPct(1 - s.shortfall / s.required_total, 0)} of the payments. {money(s.shortfall)} is still uncovered{firstGap ? `, starting ${date(firstGap.date)}` : ""}.</>
              )}
            </h2>
            <p className="mt-1.5 text-[13px] text-muted-foreground">
              {s.savings_vs_manual != null && s.savings_vs_manual > 0 && <>{money(s.savings_vs_manual)} cheaper than picking bonds by hand. </>}
              Cash arrives on average {num(s.avg_wait_days, 0)} days before it is needed and is never late.
              {" "}Prices as of {date(s.data_date)}, settling {date(r.settle)}.
            </p>
            {!ok && r.message && <p className="mt-1.5 text-[13px] font-medium">{r.message}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

export function KpiGrid({ r }: { r: Result }) {
  const s = r.summary!;
  const premium = s.liability_pv && s.covered_all ? (s.cost / s.liability_pv - 1) * 100 : null;
  const gap = s.portfolio_mod_dur - s.liability_mod_dur;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-8">
      <Stat icon={<Coins />} label="Investment today" value={money(s.cost)} sub={`for ${money(s.required_total)} of payments`} />
      <Stat icon={<TrendingDown />} label="Liabilities' value today" value={money(s.liability_pv)}
        sub={premium != null ? `cash-matching costs ${pct(premium, 2)} more` : `on the G-Sec curve`}
        hint={<Hint>Present value of the payments on the fitted G-Sec zero curve. The gap to the investment is the price of certainty: exact timing instead of having to sell bonds later.</Hint>} />
      <Stat icon={<PiggyBank />} label="Saving vs manual" value={s.savings_vs_manual != null ? money(s.savings_vs_manual) : "—"}
        sub={s.savings_pct != null ? `${pct(s.savings_pct, 2)} less than the manual pick` : "needs full coverage"} tone={s.savings_vs_manual && s.savings_vs_manual > 0 ? "good" : undefined} />
      <Stat icon={<Layers />} label="Bonds used" value={s.bonds_used} sub={`of ${s.eligible_bonds} eligible`} />
      <Stat icon={s.min_coverage >= 0.9999 ? <CheckCircle2 /> : <XCircle />} label="Lowest coverage" value={ratioPct(s.min_coverage, 0)}
        tone={s.min_coverage >= 0.9999 ? "good" : "critical"} sub={s.shortfall > 0 ? `${money(s.shortfall)} short` : "every payment met"} />
      <Stat icon={<Gauge />} label="Duration: assets vs liabilities" value={`${num(s.portfolio_mod_dur)} / ${num(s.liability_mod_dur)}`}
        sub={`${gap >= 0 ? "+" : ""}${num(gap)} yrs gap · modified duration`} />
      <Stat icon={<Coins />} label="Portfolio yield" value={pct(s.portfolio_yield, 2)} sub={`convexity ${num(s.portfolio_convexity, 1)}`} />
      <Stat icon={<Clock />} label="Idle cash" value={`${num(s.avg_wait_days, 0)} days`}
        sub={`avg wait · leftover ${money(s.leftover_cash + s.residual_value)}`}
        hint={<Hint>Average days a rupee of bond cash waits before it pays a liability. Leftover = cash after the final payment plus today's value of bond cash flows arriving after it.</Hint>} />
    </div>
  );
}
