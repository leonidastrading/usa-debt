// Treasury FiscalData API loaders: auctions, debt totals, marketable maturity schedule.
import { REVALIDATE_SECONDS } from "./fred.ts";

const BASE = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service";

async function fiscal<T>(path: string, params: Record<string, string>): Promise<T[]> {
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const res = await fetch(`${BASE}${path}?${qs}`, { next: { revalidate: REVALIDATE_SECONDS } });
  if (!res.ok) throw new Error(`FiscalData ${path}: HTTP ${res.status}`);
  const json = (await res.json()) as { data: T[] };
  return json.data;
}

const num = (s: string | null | undefined): number | null => {
  if (s == null || s === "null" || s === "*" || s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

export function isoDaysAgo(days: number, from = new Date()): string {
  const d = new Date(from.getTime() - days * 86400000);
  return d.toISOString().slice(0, 10);
}

// ---------- Auctions ----------

export type Auction = {
  date: string;
  term: string; // original term, e.g. "10-Year"
  reopening: boolean;
  type: string;
  offering: number; // $
  highYield: number | null; // %
  bidToCover: number | null;
  indirectShare: number | null; // % of competitive accepted
  dealerShare: number | null;
};

type RawAuction = Record<string, string>;

export async function getAuctions(sinceDays = 3 * 365): Promise<Auction[]> {
  const rows = await fiscal<RawAuction>("/v1/accounting/od/auctions_query", {
    filter: `security_type:in:(Note,Bond),auction_date:gte:${isoDaysAgo(sinceDays)}`,
    fields:
      "auction_date,security_term,original_security_term,security_type,high_yield,bid_to_cover_ratio," +
      "indirect_bidder_accepted,primary_dealer_accepted,comp_accepted,offering_amt,inflation_index_security,floating_rate",
    sort: "-auction_date",
    "page[size]": "1000",
  });
  return rows
    .filter((r) => r.inflation_index_security !== "Yes" && r.floating_rate !== "Yes")
    .map((r) => {
      const comp = num(r.comp_accepted);
      const ind = num(r.indirect_bidder_accepted);
      const pd = num(r.primary_dealer_accepted);
      return {
        date: r.auction_date,
        term: r.original_security_term || r.security_term,
        reopening: r.security_term !== r.original_security_term,
        type: r.security_type,
        offering: num(r.offering_amt) ?? 0,
        highYield: num(r.high_yield),
        bidToCover: num(r.bid_to_cover_ratio),
        indirectShare: comp && ind != null ? (100 * ind) / comp : null,
        dealerShare: comp && pd != null ? (100 * pd) / comp : null,
      };
    });
}

// ---------- Debt totals ----------

export type DebtTotals = {
  date: string;
  totalDebt: number;
  heldByPublic: number;
};

export async function getDebtTotals(): Promise<DebtTotals | null> {
  const rows = await fiscal<RawAuction>("/v2/accounting/od/debt_to_penny", {
    sort: "-record_date",
    "page[size]": "1",
  });
  const r = rows[0];
  if (!r) return null;
  return {
    date: r.record_date,
    totalDebt: num(r.tot_pub_debt_out_amt) ?? 0,
    heldByPublic: num(r.debt_held_public_amt) ?? 0,
  };
}

export type AvgRate = { date: string; desc: string; rate: number };

export async function getAvgRates(): Promise<AvgRate[]> {
  const rows = await fiscal<RawAuction>("/v2/accounting/od/avg_interest_rates", {
    filter: "security_type_desc:eq:Marketable",
    sort: "-record_date",
    "page[size]": "12",
  });
  const latest = rows[0]?.record_date;
  return rows
    .filter((r) => r.record_date === latest)
    .map((r) => ({ date: r.record_date, desc: r.security_desc, rate: num(r.avg_interest_rate_amt) ?? 0 }));
}

// ---------- Maturity schedule (Monthly Statement of the Public Debt, table 3) ----------

export type MaturityBucket = {
  /** Years from the record date, 0 = matures within 12 months. */
  yearIndex: number;
  amount: number; // $
  /** Weighted average coupon/yield of the bucket, %. */
  rate: number;
  billShare: number; // share of the bucket that is bills/FRNs (reprices at short rates)
};

export type MaturityProfile = {
  recordDate: string;
  totalMarketable: number;
  buckets: MaturityBucket[];
  weightedAvgMaturityYears: number;
};

export function buildMaturityProfile(rows: RawAuction[], recordDate: string): MaturityProfile {
  const rec = new Date(recordDate + "T00:00:00Z").getTime();
  const acc = new Map<number, { amt: number; rateAmt: number; bill: number }>();
  let total = 0;
  let wam = 0;
  for (const r of rows) {
    const cls = r.security_class1_desc ?? "";
    const id = r.security_class2_desc ?? "";
    if (cls.startsWith("Total") || id.startsWith("Total") || cls === "Federal Financing Bank") continue;
    const amt = num(r.outstanding_amt);
    if (amt == null || amt <= 0 || !r.maturity_date || r.maturity_date === "null") continue;
    const yrs = (new Date(r.maturity_date + "T00:00:00Z").getTime() - rec) / (365.25 * 86400000);
    if (yrs < 0) continue;
    const isBill = cls.startsWith("Bills") || cls.startsWith("Floating");
    const rate = num(r.interest_rate_pct) ?? num(r.yield_pct) ?? 0;
    const idx = Math.min(30, Math.floor(yrs));
    const b = acc.get(idx) ?? { amt: 0, rateAmt: 0, bill: 0 };
    const dollars = amt * 1e6; // table reports millions
    b.amt += dollars;
    b.rateAmt += dollars * rate;
    if (isBill) b.bill += dollars;
    acc.set(idx, b);
    total += dollars;
    wam += dollars * yrs;
  }
  const buckets = [...acc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([yearIndex, b]) => ({
      yearIndex,
      amount: b.amt,
      rate: b.amt ? b.rateAmt / b.amt : 0,
      billShare: b.amt ? b.bill / b.amt : 0,
    }));
  return { recordDate, totalMarketable: total, buckets, weightedAvgMaturityYears: total ? wam / total : 0 };
}

export async function getMaturityProfile(): Promise<MaturityProfile | null> {
  const latest = await fiscal<RawAuction>("/v1/debt/mspd/mspd_table_3_market", {
    fields: "record_date",
    sort: "-record_date",
    "page[size]": "1",
  });
  const recordDate = latest[0]?.record_date;
  if (!recordDate) return null;
  const rows = await fiscal<RawAuction>("/v1/debt/mspd/mspd_table_3_market", {
    filter: `record_date:eq:${recordDate}`,
    fields: "security_class1_desc,security_class2_desc,interest_rate_pct,yield_pct,maturity_date,outstanding_amt",
    "page[size]": "10000",
  });
  return buildMaturityProfile(rows, recordDate);
}

// ---------- History series for the dashboard charts ----------

export type DebtHistory = { dates: string[]; total: number[]; public: number[] };

/** Daily total public debt and debt held by the public ($), from Debt to the Penny. */
export async function getDebtHistory(since = "2006-01-01"): Promise<DebtHistory> {
  const rows = await fiscal<RawAuction>("/v2/accounting/od/debt_to_penny", {
    filter: `record_date:gte:${since}`,
    fields: "record_date,tot_pub_debt_out_amt,debt_held_public_amt",
    sort: "record_date",
    "page[size]": "10000",
  });
  const out: DebtHistory = { dates: [], total: [], public: [] };
  for (const r of rows) {
    const total = num(r.tot_pub_debt_out_amt);
    if (total == null) continue;
    out.dates.push(r.record_date);
    out.total.push(total);
    out.public.push(num(r.debt_held_public_amt) ?? NaN);
  }
  return out;
}

export type InterestHistory = {
  /** Month-end dates. */
  dates: string[];
  /** Interest on debt held by the public in that month ($). */
  publicMonthly: number[];
  /** Interest credited to trust funds and other government accounts in that month ($). */
  intragovMonthly: number[];
};

/** Monthly federal interest expense (Treasury "Interest Expense on the Public Debt Outstanding"). */
export async function getInterestHistory(): Promise<InterestHistory> {
  const rows = await fiscal<RawAuction>("/v2/accounting/od/interest_expense", {
    fields: "record_date,expense_catg_desc,month_expense_amt",
    sort: "record_date",
    "page[size]": "10000",
  });
  const byMonth = new Map<string, { pub: number; gov: number }>();
  for (const r of rows) {
    const amt = num(r.month_expense_amt);
    if (amt == null) continue;
    const m = byMonth.get(r.record_date) ?? { pub: 0, gov: 0 };
    if (r.expense_catg_desc.includes("PUBLIC ISSUES")) m.pub += amt;
    else m.gov += amt;
    byMonth.set(r.record_date, m);
  }
  const dates = [...byMonth.keys()].sort();
  return {
    dates,
    publicMonthly: dates.map((d) => byMonth.get(d)!.pub),
    intragovMonthly: dates.map((d) => byMonth.get(d)!.gov),
  };
}

// ---------- Same-day yield curve (fills FRED's one-day lag) ----------

/** Treasury yield-curve CSV column -> FRED constant-maturity series it feeds. */
const CURVE_COLUMNS: Record<string, string> = {
  "3 Mo": "DGS3MO", "2 Yr": "DGS2", "3 Yr": "DGS3", "5 Yr": "DGS5",
  "7 Yr": "DGS7", "10 Yr": "DGS10", "20 Yr": "DGS20", "30 Yr": "DGS30",
};

export function parseYieldCurveCsv(text: string): Record<string, { date: string; value: number }[]> {
  const lines = text.trim().split(/\r?\n/);
  const head = lines[0].split(",").map((h) => h.replace(/"/g, "").trim());
  const out: Record<string, { date: string; value: number }[]> = {};
  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    const [m, d, y] = cells[0].split("/");
    if (!y) continue;
    const date = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    head.forEach((h, i) => {
      const id = CURVE_COLUMNS[h];
      const v = Number(cells[i]);
      if (id && cells[i] !== "" && Number.isFinite(v)) (out[id] ??= []).push({ date, value: v });
    });
  }
  for (const id in out) out[id].sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

async function yieldCurveMonth(yyyymm: string) {
  const url =
    "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/all/" +
    `${yyyymm}?type=daily_treasury_yield_curve&field_tdr_date_value_month=${yyyymm}&page&_format=csv`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000), next: { revalidate: REVALIDATE_SECONDS / 2 } });
  if (!res.ok) throw new Error(`Treasury yield curve ${yyyymm}: HTTP ${res.status}`);
  return parseYieldCurveCsv(await res.text());
}

/**
 * The last two months of Treasury's daily par yield curve. Treasury posts each day's curve
 * the same evening; FRED's DGS series (the same numbers) appear a day later. Month-scoped
 * requests take ~1s; the whole-year file can take 15s+ when Treasury's cache is cold.
 */
export async function getTreasuryYieldCurve(now = new Date()) {
  const ym = (d: Date) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const months = await Promise.all([yieldCurveMonth(ym(prev)), yieldCurveMonth(ym(now))]);
  const out: Record<string, { date: string; value: number }[]> = {};
  for (const m of months) for (const [id, obs] of Object.entries(m)) (out[id] ??= []).push(...obs);
  for (const id in out) out[id].sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

/** Append Treasury observations newer than FRED's last one to each FRED series. */
export function mergeNewer<T extends { date: string; value: number }>(
  fred: Record<string, T[]>,
  extra: Record<string, T[]>,
): Record<string, T[]> {
  const out = { ...fred };
  for (const [id, obs] of Object.entries(extra)) {
    if (!(id in out)) continue;
    const base = out[id] ?? [];
    const last = base.length ? base[base.length - 1].date : "";
    const newer = obs.filter((o) => o.date > last);
    if (newer.length) out[id] = [...base, ...newer];
  }
  return out;
}
