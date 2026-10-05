// News feed: Google News RSS searches for each topic plus Federal Reserve press releases.
import { REVALIDATE_SECONDS } from "./fred.ts";

export type NewsItem = {
  title: string;
  link: string;
  source: string;
  published: string; // ISO
  topic: string;
};

export const TOPICS: { id: string; label: string; query?: string; feed?: string }[] = [
  { id: "auctions", label: "Auctions", query: '"Treasury auction" OR "bond auction" OR "bid-to-cover"' },
  { id: "yields", label: "Yields & bond market", query: '"Treasury yields" OR "bond market" OR "bond selloff" OR "10-year yield"' },
  { id: "fiscal", label: "Debt & deficits", query: '"debt ceiling" OR "federal deficit" OR "national debt" OR "US credit rating"' },
  { id: "fed", label: "Fed & liquidity", query: '"Federal Reserve" (repo OR "balance sheet" OR "quantitative tightening" OR "rate cut" OR "rate hike")' },
  { id: "global", label: "Global bonds", query: '"term premium" OR "bond vigilantes" OR gilts OR "JGB yields" OR "Bund yields"' },
  { id: "fedpress", label: "Fed press releases", feed: "https://www.federalreserve.gov/feeds/press_all.xml" },
];

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

export function parseRss(xml: string, topic: string, defaultSource = ""): NewsItem[] {
  const items: NewsItem[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const body = m[1];
    let title = tag(body, "title");
    const source = tag(body, "source") || defaultSource;
    // Google News appends " - Source" to titles.
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    const date = Date.parse(tag(body, "pubDate"));
    if (!title) continue;
    items.push({
      title,
      link: tag(body, "link"),
      source,
      published: Number.isFinite(date) ? new Date(date).toISOString() : "",
      topic,
    });
  }
  return items;
}

async function fetchTopic(t: (typeof TOPICS)[number]): Promise<NewsItem[]> {
  const url = t.feed
    ? t.feed
    : `https://news.google.com/rss/search?q=${encodeURIComponent(`${t.query} when:7d`)}&hl=en-US&gl=US&ceid=US:en`;
  const res = await fetch(url, { next: { revalidate: REVALIDATE_SECONDS / 2 } });
  if (!res.ok) throw new Error(`news ${t.id}: HTTP ${res.status}`);
  return parseRss(await res.text(), t.id, t.feed ? "Federal Reserve" : "").slice(0, t.feed ? 15 : 25);
}

export async function getNews(): Promise<{ items: NewsItem[]; errors: string[] }> {
  const results = await Promise.allSettled(TOPICS.map(fetchTopic));
  const seen = new Set<string>();
  const items: NewsItem[] = [];
  const errors: string[] = [];
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      errors.push(TOPICS[i].label);
      return;
    }
    for (const it of r.value) {
      const key = it.title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 80);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(it);
    }
  });
  items.sort((a, b) => b.published.localeCompare(a.published));
  return { items, errors };
}
