// Server-side data assembly for the pages. Every upstream fetch is cached by Next.js
// for REVALIDATE_SECONDS, so a page render costs nothing once the cache is warm.
import { analyzeAuctions, CMT_FOR_TERM } from "./auctions.ts";
import { fredMany, fredSeries, HISTORY_START } from "./fred.ts";
import { computeIndicators, computeRegimes, currentCurve, FRED_IDS } from "./regimes.ts";
import { getAuctions, getAvgRates, getDebtTotals, getMaturityProfile, isoDaysAgo } from "./treasury.ts";

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
