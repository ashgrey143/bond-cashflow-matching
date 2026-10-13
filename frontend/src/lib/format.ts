const CR = 1e7;
const LAKH = 1e5;

/** Indian money: Rs 5.86 cr / Rs 12.4 L / Rs 8,450 */
export function money(v: number | null | undefined, digits = 2): string {
  if (v == null || !isFinite(v)) return "—";
  const a = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (a >= CR) return `${sign}₹${(a / CR).toFixed(digits)} cr`;
  if (a >= LAKH) return `${sign}₹${(a / LAKH).toFixed(digits > 1 ? 1 : digits)} L`;
  return `${sign}₹${a.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export const crore = (v: number | null | undefined, d = 2) => (v == null || !isFinite(v) ? "—" : (v / CR).toFixed(d));

export function inr(v: number | null | undefined, d = 0): string {
  if (v == null || !isFinite(v)) return "—";
  return v.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function num(v: number | null | undefined, d = 2): string {
  if (v == null || !isFinite(v)) return "—";
  return v.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
}

export const pct = (v: number | null | undefined, d = 1) => (v == null || !isFinite(v) ? "—" : `${num(v, d)}%`);
export const ratioPct = (v: number | null | undefined, d = 1) => (v == null || !isFinite(v) ? "—" : `${num(v * 100, d)}%`);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function date(s: string | null | undefined, short = false): string {
  if (!s) return "—";
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return short ? `${MONTHS[m - 1]} ${String(y).slice(2)}` : `${String(d).padStart(2, "0")} ${MONTHS[m - 1]} ${y}`;
}

export function monthLabel(s: string): string {
  const [y, m] = s.split("-").map(Number);
  return `${MONTHS[m - 1]} ${String(y).slice(2)}`;
}

export const axisCr = (v: number) => (Math.abs(v) >= CR ? `${(v / CR).toFixed(1)} cr` : Math.abs(v) >= LAKH ? `${(v / LAKH).toFixed(0)} L` : `${v.toFixed(0)}`);

export function shortName(desc: string): string {
  return desc.replace(/GOVT\.?\s*STOCK/i, "GS").replace(/\s+/g, " ").trim();
}
