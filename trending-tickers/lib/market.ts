// Top stories about the market as a whole: CNBC's top news and economy feeds plus Yahoo Finance's
// S&P 500 / Dow / Nasdaq feed, scored for how much each story is about the overall market rather
// than one company, then the best three from the last day.
import { fetchRss, sourceName, type Headline } from "./trending.ts";

const FEEDS = [
  { url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114", source: "CNBC" },
  { url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258", source: "CNBC" },
  { url: "https://feeds.finance.yahoo.com/rss/2.0/headline?s=%5EGSPC,%5EDJI,%5EIXIC&region=US&lang=en-US", source: "" },
];

// Words that mark a story about the whole market, weighted by how strongly they do.
const SIGNALS: [RegExp, number][] = [
  [/\b(stock futures|stock market|wall street|s&p 500|s&p|nasdaq|dow jones|the dow|russell 2000|small caps|market rally|sell-?off|selloff)\b/i, 3],
  [/\b(stocks|equities|indexes|indices|futures|bull market|bear market|correction|volatility|vix)\b/i, 2],
  [/\b(fed|federal reserve|powell|rate (cut|hike)s?|interest rates?|treasury yields?|10-year|bond (market|yields?)|yields)\b/i, 2],
  [/\b(inflation|cpi|ppi|pce|jobs report|payrolls|unemployment|jobless claims|gdp|recession|consumer (spending|sentiment|confidence)|retail sales|economy|economic)\b/i, 2],
  [/\b(oil prices?|crude|dollar|tariffs?|trade (war|deal|deficit)|earnings season|sectors?)\b/i, 1],
];

// Single-company roundups, analyst picks and personal finance.
const NOT_MARKET = /\b(biggest moves|analyst calls|stocks to (buy|watch)|buy the dip in|my (husband|wife|brother|sister|parents)|retire(ment)?|etf charges|prediction:)\b/i;

export function marketScore(h: Pick<Headline, "title" | "summary">): number {
  if (NOT_MARKET.test(h.title)) return 0;
  let score = 0;
  for (const [re, w] of SIGNALS) {
    if (re.test(h.title)) score += w * 2;
    else if (re.test(h.summary)) score += w;
  }
  return score;
}

const norm = (title: string) => title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 60);

/** The n most market-wide stories from the last `hours` before `now`, newest first. */
export function pickMarketStories(items: Headline[], now: number, n = 3, hours = 24): Headline[] {
  const seen = new Set<string>();
  return items
    .filter((h) => h.link && Date.parse(h.published) >= now - hours * 3_600_000)
    .map((h) => ({ h, score: marketScore(h) }))
    .filter((x) => x.score >= 4)
    .sort((a, b) => b.score - a.score || b.h.published.localeCompare(a.h.published))
    .filter(({ h }) => {
      const key = norm(h.title);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, n)
    .map((x) => x.h)
    .sort((a, b) => b.published.localeCompare(a.published));
}

export async function fetchMarketStories(now = Date.now()): Promise<Headline[]> {
  const feeds = await Promise.allSettled(
    FEEDS.map(async (f) => (await fetchRss(f.url)).map((h) => ({ ...h, source: h.source || f.source || sourceName(h.link) }))),
  );
  const items = feeds.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  // A quiet overnight can leave little from the last day; widen to two days rather than show nothing.
  const picked = pickMarketStories(items, now);
  return picked.length >= 3 ? picked : pickMarketStories(items, now, 3, 48);
}
