import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { pct } from "@/lib/format";
import type { Result } from "@/lib/types";

const Eq = ({ children }: { children: ReactNode }) => (
  <div className="my-2 rounded-lg border bg-muted/40 px-4 py-3 font-mono text-[13px] leading-7">{children}</div>
);

export function MethodTab({ r }: { r: Result }) {
  const o = r.options;
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>The network optimisation model</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-[13.5px] leading-relaxed text-muted-foreground">
          <p>Every payment date is a <b className="text-foreground">node</b>. Each bond sends the coupons and redemption it pays after the previous date (and up to this one) into
            the node. Cash left after a payment flows along a <b className="text-foreground">carry arc</b> to the next node, earning the reinvestment rate. The optimiser picks
            how much of each bond to buy so that flow balances at every node at the lowest cost.</p>
          <Eq>
            minimise&nbsp; Σᵢ Pᵢ · xᵢ<br />
            subject to&nbsp; Σᵢ CFᵢ,ₜ · xᵢ + gₜ · sₜ₋₁ − sₜ = m · Lₜ − Eₜ &nbsp; for every date t<br />
            &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Pᵢ · xᵢ ≤ w · Σⱼ Pⱼ · xⱼ &nbsp; (per-bond limit)<br />
            &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; xᵢ ≥ 0, &nbsp; sₜ ≥ 0
          </Eq>
          <ul className="list-disc space-y-1 pl-5">
            <li><b className="text-foreground">xᵢ</b>: units of bond i (₹100 face each); whole lots make it a mixed-integer program.</li>
            <li><b className="text-foreground">Pᵢ</b>: dirty price (CCIL clean price + accrued interest to T+1 settlement) + transaction cost ({o.tx_cost_bp} bp).</li>
            <li><b className="text-foreground">CFᵢ,ₜ</b>: cash bond i delivers to date t per unit, grown at the reinvestment rate from its payment day.</li>
            <li><b className="text-foreground">sₜ</b>: cash carried from date t to t+1; gₜ = (1 + r)^years with r = {pct(o.reinvest_rate, 2)}.</li>
            <li><b className="text-foreground">Lₜ</b>: liability; m = safety margin ({pct(o.safety_margin, 0)}); Eₜ = cash from bonds you already hold.</li>
            <li>With a budget too small to cover everything, a shortfall uₜ is added and minimised first, protecting the earliest payments, then cost.</li>
          </ul>
          <p>Solved with the HiGHS solver (SciPy). Shadow prices of the flow-balance constraints give the cost today of ₹1 due on each date; reduced costs
            show how much cheaper an unused bond must be to enter.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Data and conventions</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-[13.5px] leading-relaxed text-muted-foreground">
          <ul className="list-disc space-y-1.5 pl-5">
            <li><b className="text-foreground">Source:</b> CCIL Trading Platform (security-wise outright trades). One row per ISIN: the latest trading day, the "All" platform row, the weighted-average price and yield.</li>
            <li><b className="text-foreground">Coupons</b> are parsed from the description ("6.94% GS 2036"). CCIL publishes no cash-flow matrix; we build it.</li>
            <li><b className="text-foreground">Excluded:</b> floating-rate bonds, sovereign gold bonds, inflation-indexed bonds and STRIPS. Their cash flows are not fixed coupons.</li>
            <li><b className="text-foreground">G-Secs and SDLs:</b> semi-annual coupons on the maturity day/month, 30/360, yields compounded semi-annually. <b className="text-foreground">T-Bills:</b> zero coupon, actual/365.</li>
            <li><b className="text-foreground">Validation:</b> repricing every bond from CCIL's yield with our cash flows matches CCIL's price to within ₹{(r.dataset.price_check_max ?? 0).toFixed(2)} per ₹100.</li>
            <li><b className="text-foreground">Liabilities' value</b> uses a Nelson–Siegel zero curve fitted to sovereign bond prices (RMSE {r.curve.rmse_bp.toFixed(1)} bp).</li>
            <li><b className="text-foreground">Risk:</b> modified duration and convexity per bond, market-value weighted; rate scenarios shift every yield in parallel and reprice from cash flows.</li>
            <li><b className="text-foreground">Manual strategy:</b> for each payment (latest first) buy the bond maturing closest before it until covered.</li>
            <li><b className="text-foreground">Duration strategy:</b> two liquid G-Secs bracketing the liabilities' duration, market value = liabilities' PV.</li>
          </ul>
          <p className="text-[12px]">CCIL does not authorise commercial use of its website data without written permission. This tool is for academic use.</p>
        </CardContent>
      </Card>
    </div>
  );
}
