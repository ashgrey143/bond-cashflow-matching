export type Source = "sample" | "upload" | "ccil";

export interface DatasetInfo {
  id: string;
  source: Source;
  label: string;
  rows: number;
  securities: number;
  usable: number;
  trade_dates: string[];
  last_trade_date: string;
  settle: string;
  by_category: Record<string, number>;
  price_check_max: number | null;
  curve_rmse_bp: number;
  loaded_at: string;
}

export interface Liability { date: string; amount: number }
export interface HoldingInput { isin: string; face: number }

export interface Options {
  reinvest_rate: number;
  safety_margin: number;
  budget: number | null;
  max_weight: number;
  lot_face: number;
  max_volume_pct: number;
  tx_cost_bp: number;
  holdings: HoldingInput[];
}

export interface Filters {
  include_gsec: boolean;
  include_sdl: boolean;
  include_tbill: boolean;
  min_trades: number;
  min_volume: number;
  max_stale_days: number;
  exclude: string[];
}

export interface Holding {
  isin: string; description: string; category: string; coupon: number; maturity: string;
  units: number; face: number; lots: number | null; clean: number; accrued: number; dirty: number;
  unit_cost: number; cost: number; weight: number; yield: number; ccil_ytm: number;
  mod_dur: number; convexity: number; volume: number; trades: number; last_trade: string;
  stale_days: number; order_pct_volume: number | null; liquidity: "OK" | "Watch" | "Illiquid";
}

export interface ScheduleRow {
  date: string; liability: number; required: number; existing_cash: number; bond_cash: number;
  carried_in: number; shortfall: number; paid: number; carried_out: number; coverage: number;
}

export interface Bond {
  isin: string; description: string; category: string; kind: string; coupon: number; maturity: string;
  price: number; accrued: number; dirty: number; ytm: number; yield: number; mod_dur: number;
  convexity: number; years: number; volume: number; trades: number; date: string; stale_days: number;
  price_check: number;
}

export interface Scenario {
  name: string; description: string; status: string; cost?: number; delta_cost?: number; delta_pct?: number;
  bonds_used?: number; min_coverage?: number; mod_dur?: number; convexity?: number;
  units?: Record<string, number>; message?: string; base_portfolio_value?: number;
  base_value_change_pct?: number; base_portfolio_coverage?: number; base_portfolio_shortfall?: number;
  note?: string; removed?: string; base_without_removed?: boolean;
  holdings?: { isin: string; description: string; maturity: string; coupon: number; face: number; cost: number;
               dirty: number; yield: number; weight: number; base_face: number }[];
  dropped?: { isin: string; description: string; base_face: number }[];
  schedule?: { date: string; required: number; paid: number; shortfall: number; coverage: number }[];
}

export interface Strategy {
  name: string; available: boolean; note: string; cost?: number; bonds_used?: number;
  min_coverage?: number; shortfall?: number; leftover?: number; mod_dur?: number;
  holdings?: { isin: string; description: string; face: number }[];
}

export interface Summary {
  covered_all: boolean; cost: number; liability_total: number; required_total: number; liability_pv: number;
  payments: number; bonds_used: number; min_coverage: number; shortfall: number; leftover_cash: number;
  residual_value: number; portfolio_mod_dur: number; liability_mod_dur: number; portfolio_convexity: number;
  liability_convexity: number; portfolio_yield: number; avg_wait_days: number; avg_idle_balance: number;
  max_idle_balance: number; first_payment: string; last_payment: string; eligible_bonds: number;
  illiquid: number; watch: number; data_date: string; manual_cost?: number; savings_vs_manual?: number;
  savings_pct?: number; savings_note?: string;
}

export interface Result {
  status: "optimal" | "shortfall" | "infeasible";
  message: string;
  warnings: string[];
  dataset: DatasetInfo;
  settle: string;
  universe: Bond[];
  excluded: (Partial<Bond> & { reason: string })[];
  curve: { points: { isin: string; description: string; category: string; years: number; ytm: number; yield: number; volume: number }[];
           fitted: { years: number; rate: number }[]; rmse_bp: number };
  liabilities: Liability[];
  options: Options;
  summary?: Summary;
  holdings?: Holding[];
  schedule?: ScheduleRow[];
  duals?: { date: string; shadow_price: number; implied_rate: number | null; years: number }[];
  reduced?: { isin: string; description: string; maturity: string; dirty: number; yield: number; reduced_cost: number;
              needed_drop_pct: number; selected: boolean; value_ratio: number }[];
  risk?: { portfolio: { value: number; mod_dur: number; mac_dur: number; convexity: number; yield: number };
           liabilities: { pv: number; mod_dur: number; mac_dur: number; convexity: number } };
  shock?: { shift_bp: number; portfolio_value: number; change_pct: number; duration_est_pct: number;
            dur_conv_est_pct: number; liability_pv: number; liability_change_pct: number; surplus: number }[];
  calendar?: { month: string; inflow: number; payment: number; balance: number }[];
  sankey?: { nodes: { name: string; kind: string }[]; links: { source: number; target: number; value: number; kind: string }[] };
  matrix?: { dates: string[]; rows: { isin: string; description: string; cf: number[] }[] };
  scenarios?: Scenario[];
  uncertainty?: { factor: number; label: string; cost: number | null; status: string; base_coverage: number;
                  base_shortfall: number; liability_total: number }[];
  strategies?: Strategy[];
  constraints?: { max_weight: { limit: number; cost: number | null }[];
                  min_volume: { limit: number; bonds: number; cost: number | null }[] };
}
