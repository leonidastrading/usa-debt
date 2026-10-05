// FRED (St. Louis Fed) loader. Uses the official API when FRED_API_KEY is set,
// otherwise the public fredgraph.csv endpoint, which needs no key.

export type Obs = { date: string; value: number };

export const REVALIDATE_SECONDS = 6 * 60 * 60;
export const HISTORY_START = "2006-01-01";

async function fromApi(id: string, start: string, key: string): Promise<Obs[]> {
  const url =
    `https://api.stlouisfed.org/fred/series/observations?series_id=${id}` +
    `&api_key=${key}&file_type=json&observation_start=${start}`;
  const res = await fetch(url, { next: { revalidate: REVALIDATE_SECONDS } });
  if (!res.ok) throw new Error(`FRED API ${id}: HTTP ${res.status}`);
  const json = (await res.json()) as { observations: { date: string; value: string }[] };
  return json.observations
    .map((o) => ({ date: o.date, value: Number(o.value) }))
    .filter((o) => Number.isFinite(o.value));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fromCsv(id: string, start: string): Promise<Obs[]> {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${start}`;
  // The public endpoint 503s browser-like and default fetch user agents (bot filter) and
  // throttles bursts. A command-line-tool UA gets through; retry the rest with backoff.
  // For production, set FRED_API_KEY and the official API is used instead.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      headers: { "User-Agent": "curl/8.5.0", Accept: "text/csv" },
      next: { revalidate: REVALIDATE_SECONDS },
    });
    if (res.ok) return parseFredCsv(await res.text());
    if (attempt >= 3 || (res.status !== 503 && res.status !== 429)) {
      throw new Error(`FRED CSV ${id}: HTTP ${res.status}`);
    }
    await sleep(500 * 2 ** attempt + Math.random() * 300);
  }
}

export function parseFredCsv(text: string): Obs[] {
  const out: Obs[] = [];
  const lines = text.trim().split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const [date, raw] = lines[i].split(",");
    const value = Number(raw);
    if (date && raw !== "." && raw !== "" && Number.isFinite(value)) out.push({ date, value });
  }
  return out;
}

export async function fredSeries(id: string, start = HISTORY_START): Promise<Obs[]> {
  const key = process.env.FRED_API_KEY;
  if (key) {
    try {
      return await fromApi(id, start, key);
    } catch {
      // fall through to the CSV endpoint
    }
  }
  return fromCsv(id, start);
}

/**
 * Fetch many series a few at a time (FRED throttles bursts).
 * A failed series comes back empty instead of failing the page.
 */
export async function fredMany(ids: string[], start = HISTORY_START, concurrency = 3): Promise<Record<string, Obs[]>> {
  const out: Record<string, Obs[]> = {};
  let next = 0;
  async function worker() {
    while (next < ids.length) {
      const id = ids[next++];
      try {
        out[id] = await fredSeries(id, start);
      } catch (err) {
        console.error(`[fred] ${id}:`, err);
        out[id] = [];
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
  return out;
}
