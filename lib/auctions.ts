// Auction demand analysis: compares each coupon auction to recent auctions of the same tenor.
import type { Obs } from "./fred.ts";
import type { Auction } from "./treasury.ts";

export const CMT_FOR_TERM: Record<string, string> = {
  "2-Year": "DGS2",
  "3-Year": "DGS3",
  "5-Year": "DGS5",
  "7-Year": "DGS7",
  "10-Year": "DGS10",
  "20-Year": "DGS20",
  "30-Year": "DGS30",
};

export type AuctionRow = Auction & {
  btcVsAvg: number | null; // bid-to-cover minus trailing average of the same tenor
  indirectVsAvg: number | null; // percentage points
  /** Auction high yield minus same-day constant-maturity close, bp. Noisy proxy for the tail. */
  vsCloseBp: number | null;
  weak: boolean;
  strong: boolean;
};

const TRAIL = 6;

export function analyzeAuctions(auctions: Auction[], cmt: Record<string, Obs[]>, today: string) {
  const done = auctions.filter((a) => a.bidToCover != null && a.term in CMT_FOR_TERM);
  const upcoming = auctions
    .filter((a) => a.bidToCover == null && a.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));

  const byTerm = new Map<string, Auction[]>();
  for (const a of [...done].sort((x, y) => x.date.localeCompare(y.date))) {
    byTerm.set(a.term, [...(byTerm.get(a.term) ?? []), a]);
  }

  const rows: AuctionRow[] = [];
  for (const [term, list] of byTerm) {
    const series = cmt[CMT_FOR_TERM[term]] ?? [];
    const closeOn = new Map(series.map((o) => [o.date, o.value]));
    list.forEach((a, i) => {
      const prior = list.slice(Math.max(0, i - TRAIL), i);
      const avg = (f: (x: Auction) => number | null) => {
        const v = prior.map(f).filter((x): x is number => x != null);
        return v.length >= 3 ? v.reduce((s, x) => s + x, 0) / v.length : null;
      };
      const btcAvg = avg((x) => x.bidToCover);
      const indAvg = avg((x) => x.indirectShare);
      const btcVsAvg = btcAvg != null && a.bidToCover != null ? a.bidToCover - btcAvg : null;
      const indirectVsAvg = indAvg != null && a.indirectShare != null ? a.indirectShare - indAvg : null;
      const close = closeOn.get(a.date);
      const vsCloseBp = close != null && a.highYield != null ? Math.round((a.highYield - close) * 100 * 10) / 10 : null;
      rows.push({
        ...a,
        btcVsAvg,
        indirectVsAvg,
        vsCloseBp,
        weak: (btcVsAvg ?? 0) <= -0.1 && (indirectVsAvg ?? 0) <= -3,
        strong: (btcVsAvg ?? 0) >= 0.1 && (indirectVsAvg ?? 0) >= 3,
      });
    });
  }
  rows.sort((a, b) => b.date.localeCompare(a.date));

  // How many of the last 8 completed auctions were clearly weak or strong.
  const recent = rows.slice(0, 8);
  const weakCount = recent.filter((r) => r.weak).length;
  const strongCount = recent.filter((r) => r.strong).length;
  return { rows, upcoming, weakCount, strongCount, recentCount: recent.length };
}
