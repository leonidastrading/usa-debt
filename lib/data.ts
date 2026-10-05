// Server-side data assembly for the pages. Every upstream fetch is cached by Next.js
// for REVALIDATE_SECONDS, so a page render costs nothing once the cache is warm.
import { analyzeAuctions, CMT_FOR_TERM } from "./auctions.ts";
import { priceIndex } from "./bonds.ts";
import { fredMany, fredSeries, HISTORY_START, type Obs } from "./fred.ts";
import { computeIndicators, computeRegimes, currentCurve, FRED_IDS } from "./regimes.ts";
import { asOf } from "./stats.ts";
import { getAuctions, getAvgRates, getDebtHistory, getDebtTotals, getInterestHistory, getMaturityProfile, isoDaysAgo } from "./treasury.ts";

async function settle<T>(label: string, p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    console.error(`[data] ${label}:`, err);
    return null;
  }
}

export async function getMarket() {
  const data = await fredMany([...FRED_IDS], HISTORY_START);
  return {
    data,
    regimes: computeRegimes(data),
    indicators: computeIndicators(data),
    curve: currentCurve(data),
    missing: FRED_IDS.filter((id) => (data[id] ?? []).length === 0),
  };
}

export async function getAuctionData() {
  const [auctions, cmt] = await Promise.all([
    settle("auctions", getAuctions()),
    fredMany(Object.values(CMT_FOR_TERM), isoDaysAgo(3 * 365 + 30)),
  ]);
  if (!auctions) return null;
  return analyzeAuctions(auctions, cmt, new Date().toISOString().slice(0, 10));
}

export async function getFiscal() {
  const [profile, totals, avgRates, gdp] = await Promise.all([
    settle("maturity profile", getMaturityProfile()),
    settle("debt totals", getDebtTotals()),
    settle("avg rates", getAvgRates()),
    settle("gdp", fredSeries("GDP", "2020-01-01")),
  ]);
  const lastGdp = gdp && gdp.length ? gdp[gdp.length - 1] : null;
  return {
    profile,
    totals,
    avgRates: avgRates ?? [],
    gdp: lastGdp ? { date: lastGdp.date, value: lastGdp.value * 1e9 } : null,
  };
}

const round = (v: number, d: number) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : NaN);

/** Bond prices/yields, total debt and interest expense histories for the dashboard charts. */
export async function getHistoryCharts(fred: Record<string, Obs[]>) {
  const [debt, interest] = await Promise.all([
    settle("debt history", getDebtHistory()),
    settle("interest history", getInterestHistory()),
  ]);

  // Bonds: one calendar (10Y dates), yields and price indices for 2Y / 10Y / 30Y.
  const dates = (fred.DGS10 ?? []).map((o) => o.date);
  const tenors = [
    { id: "2y", name: "2-year", fred: "DGS2", years: 2 },
    { id: "10y", name: "10-year", fred: "DGS10", years: 10 },
    { id: "30y", name: "30-year", fred: "DGS30", years: 30 },
  ];
  const bonds = {
    dates,
    tenors: tenors.map((t) => {
      const y = fred[t.fred] ?? [];
      return {
        id: t.id,
        name: t.name,
        yields: asOf(y, dates, 5).map((v) => round(v, 2)),
        prices: asOf(priceIndex(y, t.years), dates, 5).map((v) => round(v, 2)),
      };
    }),
  };

  // Interest: trailing 12-month totals (monthly figures are seasonal and lumpy).
  let interestChart: { dates: string[]; public12m: number[]; total12m: number[] } | null = null;
  if (interest && interest.dates.length > 12) {
    const sum12 = (a: number[], i: number) => a.slice(i - 11, i + 1).reduce((s, v) => s + v, 0);
    const idx = interest.dates.map((_, i) => i).filter((i) => i >= 11);
    interestChart = {
      dates: idx.map((i) => interest.dates[i]),
      public12m: idx.map((i) => round(sum12(interest.publicMonthly, i) / 1e12, 4)),
      total12m: idx.map((i) => round((sum12(interest.publicMonthly, i) + sum12(interest.intragovMonthly, i)) / 1e12, 4)),
    };
  }

  return {
    bonds,
    debt: debt && debt.dates.length
      ? { dates: debt.dates, total: debt.total.map((v) => round(v / 1e12, 4)), public: debt.public.map((v) => round(v / 1e12, 4)) }
      : null,
    interest: interestChart,
  };
}
