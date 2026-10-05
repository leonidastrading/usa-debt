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
