import { fetchMarketStories } from "./market.ts";
import { fetchHeadlines, fetchTrending, pickTop, type Edition, type Ticker } from "./trending.ts";

export async function buildEdition(date: string): Promise<Edition> {
  const [symbols, market] = await Promise.all([fetchTrending(), fetchMarketStories().catch(() => [])]);
  // One ticker at a time: news feeds throttle bursts from cloud IPs.
  const tickers: Ticker[] = [];
  for (const t of pickTop(symbols)) tickers.push({ ...t, headlines: await fetchHeadlines(t) });
  return { date, capturedAt: new Date().toISOString(), market, tickers };
}
