// The morning edition: Stocktwits' top trending US tickers at 9 AM New York time, each with
// Stocktwits' own "why it's trending" summary and a few recent headlines from Google News.

export const TOP_N = 5;
export const EDITION_HOUR = 9; // 9 AM America/New_York
const TZ = "America/New_York";

export type Headline = { title: string; link: string; source: string; published: string };

export type Ticker = {
  rank: number;
  symbol: string;
  name: string;
  exchange: string;
  /** EXCHANGE:SYMBOL as TradingView expects it. */
  tvSymbol: string;
  instrumentClass: string;
  sector: string;
  industry: string;
  logo: string;
  watchers: number;
  score: number;
  summary: string;
  summaryAt: string;
  headlines: Headline[];
};

export type Edition = {
  /** New York calendar date of the edition, YYYY-MM-DD. */
  date: string;
  capturedAt: string;
  tickers: Ticker[];
};

// ---------- New York clock ----------

export function nyClock(now = new Date()): { date: string; hour: number; minute: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute) };
}

export function previousDate(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** The edition on show right now: today's from 9 AM New York time, yesterday's before that. */
export function currentEditionDate(now = new Date()): string {
  const ny = nyClock(now);
  return ny.hour >= EDITION_HOUR ? ny.date : previousDate(ny.date);
}

// ---------- Stocktwits ----------

// Stocktwits exchange codes → TradingView exchange prefixes.
const TV_EXCHANGE: Record<string, string> = {
  NASDAQ: "NASDAQ",
  NYSE: "NYSE",
  NYSEArca: "AMEX",
  NYSEAmerican: "AMEX",
  NYSEMkt: "AMEX",
  AMEX: "AMEX",
  BATS: "CBOE",
  CBOE: "CBOE",
  OTC: "OTC",
};

export function tvSymbol(exchange: string, symbol: string): string | null {
  const ex = TV_EXCHANGE[exchange];
  return ex ? `${ex}:${symbol.replace(/\./g, "_")}` : null;
}

type StSymbol = {
  symbol: string;
  title?: string;
  exchange?: string;
  region?: string;
  instrument_class?: string;
  sector?: string;
  industry?: string;
  logo_url?: string;
  watchlist_count?: number;
  trending_score?: number;
  rank?: number;
  trends?: { summary?: string; summary_at?: string } | null;
};

/** Pick the top US-listed tickers TradingView can chart, in Stocktwits' rank order. */
export function pickTop(symbols: StSymbol[], n = TOP_N): Omit<Ticker, "headlines">[] {
  const out: Omit<Ticker, "headlines">[] = [];
  for (const s of symbols) {
    if (out.length >= n) break;
    const tv = tvSymbol(s.exchange ?? "", s.symbol);
    if (!tv || (s.region && s.region !== "US")) continue;
    out.push({
      rank: out.length + 1,
      symbol: s.symbol,
      name: s.title ?? s.symbol,
      exchange: s.exchange ?? "",
      tvSymbol: tv,
      instrumentClass: s.instrument_class ?? "",
      sector: s.sector ?? "",
      industry: s.industry ?? "",
      logo: s.logo_url ?? "",
      watchers: s.watchlist_count ?? 0,
      score: s.trending_score ?? 0,
      summary: s.trends?.summary?.trim() ?? "",
      summaryAt: s.trends?.summary_at ?? "",
    });
  }
  return out;
}

async function fetchTrending(): Promise<StSymbol[]> {
  const res = await fetch("https://api.stocktwits.com/api/2/trending/symbols/equities.json", {
    headers: { "User-Agent": "Mozilla/5.0 (trending-tickers)", Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Stocktwits trending: HTTP ${res.status}`);
  const json = (await res.json()) as { symbols?: StSymbol[] };
  if (!json.symbols?.length) throw new Error("Stocktwits trending: empty response");
  return json.symbols;
}

// ---------- Google News ----------

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim();

const tag = (xml: string, name: string) => {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1]) : "";
};

export function parseRss(xml: string): Headline[] {
  const items: Headline[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const body = m[1];
    let title = tag(body, "title");
    const source = tag(body, "source");
    // Google News appends " - Source" to titles.
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    const date = Date.parse(tag(body, "pubDate"));
    if (!title) continue;
    items.push({
      title,
      link: tag(body, "link"),
      source,
      published: Number.isFinite(date) ? new Date(date).toISOString() : "",
    });
  }
  return items;
}

/** "AT&T Inc" → "AT&T", "Verizon Communications Inc." → "Verizon Communications". */
export function shortName(name: string): string {
  return name
    .replace(/\s*[-–]\s*(Ordinary|Common|Class)\b.*$/i, "")
    .replace(/,?\s+(Inc\.?|Incorporated|Corp\.?|Corporation|Co\.?|Ltd\.?|plc|PLC|N\.V\.|S\.A\.|Holdings?|Group|Company)$/g, "")
    .replace(/,?\s+(Inc\.?|Corp\.?|Ltd\.?|Holdings?)$/g, "")
    .trim();
}

const SOURCE_NAMES: Record<string, string> = {
  "finance.yahoo.com": "Yahoo Finance",
  "stocktwits.com": "Stocktwits",
  "247wallst.com": "24/7 Wall St.",
  "fool.com": "The Motley Fool",
  "investors.com": "Investor's Business Daily",
  "barrons.com": "Barron's",
  "zacks.com": "Zacks",
  "tikr.com": "TIKR",
};

export function sourceName(link: string): string {
  try {
    const host = new URL(link).hostname.replace(/^www\./, "");
    return SOURCE_NAMES[host] ?? host;
  } catch {
    return "";
  }
}

// Institutional-holdings filings ("XYZ Advisors buys 15,700 shares of …") crowd out real news.
const FILLER =
  /\b((shares?|stock|stake|position)\b.*\b(bought|sold|acquired|purchased|trimmed|increased|decreased|reduced|raised|lowered) by|(buys|sells|acquires|purchases|trims|raises|lowers|boosts|cuts|reduces|increases)\b.*\b(stake|position|holdings|[\d,]+ shares)|stock holdings|position in|stake in)\b/i;

export function latestHeadlines(items: Headline[], n = 3): Headline[] {
  return items
    .filter((h) => h.link && !FILLER.test(h.title))
    .sort((a, b) => b.published.localeCompare(a.published))
    .slice(0, n);
}

async function fetchRss(url: string): Promise<Headline[]> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (trending-tickers)", Accept: "application/rss+xml, application/xml" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseRss(await res.text());
}

// Yahoo Finance's per-ticker feed first (on-topic, and tolerant of cloud IPs); Google News when
// Yahoo fails or has nothing.
async function fetchHeadlines(t: { symbol: string; name: string; instrumentClass: string }): Promise<Headline[]> {
  try {
    const yahoo = await fetchRss(`https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(t.symbol)}&region=US&lang=en-US`);
    const picked = latestHeadlines(yahoo.map((h) => ({ ...h, source: h.source || sourceName(h.link) })));
    if (picked.length) return picked;
  } catch {}
  const name = shortName(t.name);
  const query = t.instrumentClass === "Stock" ? `"${name}" stock` : `"${t.symbol}" ${name}`;
  try {
    return latestHeadlines(
      await fetchRss(`https://news.google.com/rss/search?q=${encodeURIComponent(`${query} when:2d`)}&hl=en-US&gl=US&ceid=US:en`),
    );
  } catch {
    return [];
  }
}

// ---------- Edition ----------

export async function buildEdition(date: string): Promise<Edition> {
  const top = pickTop(await fetchTrending());
  // One ticker at a time: news feeds throttle bursts from cloud IPs.
  const tickers: Ticker[] = [];
  for (const t of top) tickers.push({ ...t, headlines: await fetchHeadlines(t) });
  return { date, capturedAt: new Date().toISOString(), tickers };
}
