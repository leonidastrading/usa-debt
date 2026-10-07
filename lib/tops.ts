// "Market top" monitor: valuation (fuel), tightening (pin) and breakdown (cracks) signals,
// built from live sources and evaluated monthly back to 1990 so the checklist can be
// tested against past tops.
import * as XLSX from "xlsx";
import { fredMany, REVALIDATE_SECONDS, type Obs } from "./fred.ts";

// ---------- Loaders ----------

/** fetch with a couple of retries: these sites occasionally return transient errors. */
async function fetchRetry(url: string, init: RequestInit & { next?: { revalidate: number } }, tries = 3): Promise<Response> {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, init);
      if (res.ok || i >= tries - 1 || res.status < 500) return res;
    } catch (err) {
      if (i >= tries - 1) throw err;
    }
    await new Promise((r) => setTimeout(r, 800 * (i + 1)));
  }
}

/** Shiller's monthly data (S&P price, CAPE, Excess CAPE Yield). The file link changes monthly. */
export async function getShiller(): Promise<{ month: string; price: number; cape: number; ecy: number }[]> {
  const page = await fetchRetry("https://shillerdata.com/", {
    headers: { "User-Agent": "Mozilla/5.0" },
    next: { revalidate: REVALIDATE_SECONDS * 2 },
  });
  if (!page.ok) throw new Error(`shillerdata.com: HTTP ${page.status}`);
  const href = (await page.text()).match(/href="([^"]*ie_data\.xls[^"]*)"/)?.[1];
  if (!href) throw new Error("Shiller data link not found");
  const url = href.startsWith("//") ? `https:${href}` : href;
  const res = await fetchRetry(url, { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: REVALIDATE_SECONDS * 2 } });
  if (!res.ok) throw new Error(`Shiller xls: HTTP ${res.status}`);
  return parseShiller(new Uint8Array(await res.arrayBuffer()));
}

export function parseShiller(buf: Uint8Array) {
  const wb = XLSX.read(buf);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Data, { header: 1, raw: true });
  const out: { month: string; price: number; cape: number; ecy: number }[] = [];
  for (const r of rows) {
    const d = r[0];
    if (typeof d !== "number" || d < 1871) continue;
    // Dates are year.month as a decimal: 2026.1 = October, 2026.01 = January.
    const year = Math.floor(d);
    const month = Math.round((d - year) * 100);
    if (month < 1 || month > 12) continue;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
    out.push({
      month: `${year}-${String(month).padStart(2, "0")}`,
      price: num(r[1]),
      cape: num(r[12]),
      ecy: num(r[16]) * 100,
    });
  }
  return out;
}

/** Parse a multpl.com "table/by-month" page into month -> value (first row of a month wins). */
export function parseMultplTable(html: string): Map<string, number> {
  const MON: Record<string, string> = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
  const out = new Map<string, number>();
  const re = /<td[^>]*>\s*([A-Z][a-z]{2}) \d+, (\d{4})\s*<\/td>\s*<td[^>]*>\s*(?:&#x2002;|&#8194;|\s)*([\d.,]+)/g;
  for (const m of html.matchAll(re)) {
    const k = `${m[2]}-${MON[m[1]]}`;
    const v = Number(m[3].replace(/,/g, ""));
    if (MON[m[1]] && Number.isFinite(v) && !out.has(k)) out.set(k, v);
  }
  return out;
}

/**
 * Fallback when Shiller's site is unreachable: CAPE and the S&P monthly price from multpl.com.
 * ECY is left empty here and filled from CAPE and the 10Y TIPS yield in computeTops.
 */
export async function getShillerFallback() {
  const get = async (path: string) => {
    const res = await fetchRetry(`https://www.multpl.com/${path}/table/by-month`, {
      headers: { "User-Agent": "Mozilla/5.0" },
      next: { revalidate: REVALIDATE_SECONDS * 2 },
    });
    if (!res.ok) throw new Error(`multpl ${path}: HTTP ${res.status}`);
    return parseMultplTable(await res.text());
  };
  const [cape, price] = await Promise.all([get("shiller-pe"), get("s-p-500-historical-prices")]);
  return [...cape.keys()].sort().map((month) => ({ month, price: price.get(month) ?? NaN, cape: cape.get(month)!, ecy: NaN }));
}

/** FINRA customer margin debit balances, monthly since 1997 ($ millions). */
export async function getMarginDebt(): Promise<{ month: string; debt: number }[]> {
  const res = await fetchRetry("https://www.finra.org/sites/default/files/2021-03/margin-statistics.xlsx", {
    headers: { "User-Agent": "Mozilla/5.0" },
    next: { revalidate: REVALIDATE_SECONDS * 2 },
  });
  if (!res.ok) throw new Error(`FINRA margin: HTTP ${res.status}`);
  const wb = XLSX.read(new Uint8Array(await res.arrayBuffer()));
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true });
  const out: { month: string; debt: number }[] = [];
  for (const r of rows) {
    if (typeof r[0] === "string" && /^\d{4}-\d{2}$/.test(r[0]) && typeof r[1] === "number") out.push({ month: r[0], debt: r[1] });
  }
  return out.sort((a, b) => a.month.localeCompare(b.month));
}

// ---------- Monthly helpers ----------

/** Monthly average of a daily/weekly series, keyed YYYY-MM. */
function monthlyMean(obs: Obs[]): Map<string, number> {
  const acc = new Map<string, { s: number; n: number }>();
  for (const o of obs) {
    const k = o.date.slice(0, 7);
    const a = acc.get(k) ?? { s: 0, n: 0 };
    a.s += o.value; a.n++;
    acc.set(k, a);
  }
  return new Map([...acc].map(([k, a]) => [k, a.s / a.n]));
}

/** Value as of each month, carrying the last observation forward up to `maxMonths`. */
function carry(months: string[], m: Map<string, number>, maxMonths: number): number[] {
  let last = NaN, age = Infinity;
  return months.map((k) => {
    if (m.has(k)) { last = m.get(k)!; age = 0; } else age++;
    return age <= maxMonths ? last : NaN;
  });
}

function monthsBetween(start: string, end: string): string[] {
  const out: string[] = [];
  let [y, m] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

// ---------- Signals ----------

export type Level = 0 | 1 | 2; // normal / elevated / flashing

export type SignalDef = {
  id: string;
  group: "fuel" | "pin" | "cracks";
  name: string;
  unit: string;
  decimals: number;
  rule: string;
  why: string;
  level: (i: number, s: Series) => Level;
  value: (s: Series) => number[];
};

export type Series = {
  months: string[];
  spx: number[]; // monthly average S&P 500
  cape: number[];
  ecy: number[]; // %
  buffett: number[]; // % of GDP
  marginYoY: number[]; // %
  curve: number[]; // 10Y-2Y, pp
  fed: number[]; // fed funds %
  fedChg24: number[]; // pp
  baa: number[]; // Baa - 10Y, pp
  baaRise: number[]; // pp above trailing 12-month low
  trendGap: number[]; // % S&P above its 10-month average
  sahm: number[]; // pp
  curveInvertedRecently: boolean[]; // any inverted month in prior 24
};

const lv = (flash: boolean, elev: boolean): Level => (flash ? 2 : elev ? 1 : 0);

export const SIGNALS: SignalDef[] = [
  {
    id: "cape", group: "fuel", name: "Shiller CAPE", unit: "×", decimals: 1,
    rule: "Elevated ≥ 30, flashing ≥ 35",
    why: "Price ÷ 10-year average real earnings. Above 30 only in 1929, 1997–2001, 2017–2021 and now. High CAPE doesn't time a top, but it sets how far a fall can go.",
    value: (s) => s.cape, level: (i, s) => lv(s.cape[i] >= 35, s.cape[i] >= 30),
  },
  {
    id: "ecy", group: "fuel", name: "Excess CAPE Yield", unit: "%", decimals: 2,
    rule: "Elevated < 3%, flashing < 2%",
    why: "Stocks' earnings yield (1/CAPE) minus the real bond yield (Shiller's method). How much extra return stocks offer over safe bonds. Near zero in 1929 and 2000.",
    value: (s) => s.ecy, level: (i, s) => lv(s.ecy[i] < 2, s.ecy[i] < 3),
  },
  {
    id: "buffett", group: "fuel", name: "Buffett indicator", unit: "% GDP", decimals: 0,
    rule: "Elevated ≥ 150%, flashing ≥ 200%",
    why: "Market value of US corporate equity (Fed Z.1) ÷ GDP. Quarterly, about 3 months behind. Has drifted up over decades as margins rose, so judge it against its own recent peaks.",
    value: (s) => s.buffett, level: (i, s) => lv(s.buffett[i] >= 200, s.buffett[i] >= 150),
  },
  {
    id: "margin", group: "fuel", name: "Margin debt growth", unit: "% y/y", decimals: 0,
    rule: "Elevated ≥ 20% y/y, flashing ≥ 35% y/y",
    why: "FINRA margin debt vs a year earlier. Leverage surging this fast preceded 2000, 2007 and 2021; when prices dip, forced selling makes it worse.",
    value: (s) => s.marginYoY, level: (i, s) => lv(s.marginYoY[i] >= 35, s.marginYoY[i] >= 20),
  },
  {
    id: "curve", group: "pin", name: "Yield curve (10Y − 2Y)", unit: "pp", decimals: 2,
    rule: "Elevated while inverted; flashing when it un-inverts within 2 years of an inversion",
    why: "Inversion has preceded every US recession since the 1970s. The danger usually arrives when the curve turns positive again as the Fed starts cutting (2001, 2007, 2020).",
    value: (s) => s.curve,
    level: (i, s) => lv(s.curve[i] > 0 && s.curveInvertedRecently[i], s.curve[i] <= 0),
  },
  {
    id: "fed", group: "pin", name: "Fed tightening", unit: "pp off 3y low", decimals: 2,
    rule: "Elevated if the fed funds rate is ≥ 1 pt above its 3-year low, flashing ≥ 2 pts",
    why: "Rate hikes are the pin that pops most bubbles: 1929, 1990 Japan, 2000, 2007, 2022.",
    value: (s) => s.fedChg24, level: (i, s) => lv(s.fedChg24[i] >= 2, s.fedChg24[i] >= 1),
  },
  {
    id: "trend", group: "cracks", name: "S&P vs 10-month average", unit: "%", decimals: 1,
    rule: "Elevated within 2% above it, flashing below it",
    why: "The classic trend filter (≈ 200-day average). Every major bear market started with the index breaking below it; it also gives false alarms in choppy years.",
    value: (s) => s.trendGap, level: (i, s) => lv(s.trendGap[i] < 0, s.trendGap[i] < 2),
  },
  {
    id: "credit", group: "cracks", name: "Credit spreads widening", unit: "pp off low", decimals: 2,
    rule: "Elevated if the Baa spread is ≥ 0.3 pt above its 12-month low, flashing ≥ 0.6 pt",
    why: "Bond investors usually spot trouble before stock investors. Spreads started widening months before the 2007 and 2000 equity peaks.",
    value: (s) => s.baaRise, level: (i, s) => lv(s.baaRise[i] >= 0.6, s.baaRise[i] >= 0.3),
  },
  {
    id: "sahm", group: "cracks", name: "Sahm rule (real-time)", unit: "pp", decimals: 2,
    rule: "Elevated ≥ 0.3, flashing ≥ 0.5",
    why: "Rise in the 3-month average unemployment rate vs its 12-month low. At 0.5 a recession has almost always started.",
    value: (s) => s.sahm, level: (i, s) => lv(s.sahm[i] >= 0.5, s.sahm[i] >= 0.3),
  },
];

export const GROUPS = [
  { id: "fuel", name: "Fuel", desc: "Valuation and leverage: how inflated the balloon is" },
  { id: "pin", name: "Pin", desc: "Tightening: what usually pops it" },
  { id: "cracks", name: "Cracks", desc: "Breakdown: the trend and credit starting to give way" },
] as const;

/** Major S&P 500 peaks (monthly) since 1990 with the subsequent peak-to-trough fall. */
export const TOPS = [
  { month: "1990-07", label: "1990", fall: -20 },
  { month: "1998-07", label: "1998 LTCM", fall: -19 },
  { month: "2000-03", label: "Dot-com", fall: -49 },
  { month: "2007-10", label: "2007 GFC", fall: -57 },
  { month: "2011-04", label: "2011", fall: -19 },
  { month: "2018-09", label: "2018", fall: -20 },
  { month: "2020-02", label: "Covid", fall: -34 },
  { month: "2022-01", label: "2022", fall: -25 },
];

/**
 * Phase from the three groups. Backtested since 1990: "breakdown" months (expensive and
 * cracking) were followed by a 15%+ fall within a year far more often than other months.
 */
export const PHASES = {
  normal: { key: "normal", label: "Normal", status: "good", text: "Valuations aren't stretched. Historically a poor time to bet on a top." },
  cracking: { key: "cracking", label: "Cracks, fair valuations", status: "serious", text: "Valuations aren't extreme, but the trend, credit and jobs data are breaking together. 2008 and 2020 started like this: the trouble came from credit or a shock, not from price. Take it seriously." },
  expensive: { key: "expensive", label: "Expensive, no cracks", status: "warning", text: "The balloon is inflated but nothing is breaking. Markets can stay here for years (1997–99, 2017–21). Stay invested, keep hedges cheap and in place, and watch the cracks group." },
  breakdown: { key: "breakdown", label: "Expensive and cracking", status: "critical", text: "Stretched valuations plus a trend break, widening credit or rising unemployment. This is what the start of past bear markets looked like. Hedge fully; don't buy dips until the cracks clear." },
} as const;
export type PhaseKey = keyof typeof PHASES;
export function phaseOf(fuel: number, cracks: number): PhaseKey | null {
  if (!Number.isFinite(fuel) || !Number.isFinite(cracks)) return null;
  if (fuel >= 50 && cracks >= 33) return "breakdown";
  if (fuel >= 50) return "expensive";
  // Without stretched valuations it takes a broader break (most crack lights on) to matter.
  if (cracks >= 67) return "cracking";
  return "normal";
}

// ---------- Assemble ----------

export type TopsData = Awaited<ReturnType<typeof computeTops>>;

export function computeTops(input: {
  shiller: { month: string; price: number; cape: number; ecy: number }[];
  margin: { month: string; debt: number }[];
  fred: Record<string, Obs[]>;
  start?: string;
}) {
  const { shiller, margin, fred } = input;
  const start = input.start ?? "1990-01";
  const lastShiller = shiller.filter((r) => Number.isFinite(r.cape)).at(-1)?.month ?? start;
  const lastFred = (fred.T10Y2Y ?? []).at(-1)?.date.slice(0, 7) ?? lastShiller;
  const end = lastShiller > lastFred ? lastShiller : lastFred;
  // Need 36 months of history before `start` for the look-back rules.
  const months = monthsBetween(`${Number(start.slice(0, 4)) - 3}${start.slice(4)}`, end);

  const shMap = (f: "price" | "cape" | "ecy") => new Map(shiller.filter((r) => Number.isFinite(r[f])).map((r) => [r.month, r[f]]));
  // S&P monthly average: Shiller, topped up with FRED daily data for months Shiller hasn't posted.
  const spxM = shMap("price");
  for (const [k, v] of monthlyMean(fred.SP500 ?? [])) if (!spxM.has(k)) spxM.set(k, v);
  const spx = carry(months, spxM, 1);
  const cape = carry(months, shMap("cape"), 2);
  // ECY: Shiller's own figure; if missing (fallback source), 100/CAPE minus the 10Y TIPS yield.
  const tips = carry(months, monthlyMean(fred.DFII10 ?? []), 1);
  const ecy = carry(months, shMap("ecy"), 2).map((v, i) => (Number.isFinite(v) ? v : 100 / cape[i] - tips[i]));

  // Buffett: quarterly equity market value ($m) ÷ nominal GDP ($bn, SAAR).
  const eq = new Map((fred.NCBEILQ027S ?? []).map((o) => [o.date.slice(0, 7), o.value]));
  const gdp = new Map((fred.GDP ?? []).map((o) => [o.date.slice(0, 7), o.value]));
  const buffQ = new Map<string, number>();
  for (const [k, v] of eq) if (gdp.has(k)) buffQ.set(k, (100 * v) / 1000 / gdp.get(k)!);
  // A quarter's value is known ~3 months after it starts being measured; place it at quarter end.
  const buffShift = new Map([...buffQ].map(([k, v]) => {
    const [y, m] = k.split("-").map(Number);
    const mm = m + 2, yy = y + Math.floor((mm - 1) / 12);
    return [`${yy}-${String(((mm - 1) % 12) + 1).padStart(2, "0")}`, v];
  }));
  const buffett = carry(months, buffShift, 6);

  const mdMap = new Map(margin.map((r) => [r.month, r.debt]));
  const marginYoY = months.map((k) => {
    const [y, m] = k.split("-");
    const prev = mdMap.get(`${Number(y) - 1}-${m}`), cur = mdMap.get(k);
    return prev && cur ? (100 * (cur - prev)) / prev : NaN;
  });
  // Margin data lags ~1 month: carry the latest growth figure forward one month.
  for (let i = 1; i < marginYoY.length; i++) if (!Number.isFinite(marginYoY[i]) && i === marginYoY.length - 1) marginYoY[i] = marginYoY[i - 1];

  const curve = carry(months, monthlyMean(fred.T10Y2Y ?? []), 1);
  const fed = carry(months, monthlyMean(fred.FEDFUNDS ?? []), 1);
  // Rise from the lowest rate of the previous 3 years (catches hiking cycles that follow cuts).
  const fedChg24 = fed.map((v, i) => {
    const w = fed.slice(Math.max(0, i - 36), i + 1).filter(Number.isFinite);
    return w.length >= 24 ? v - Math.min(...w) : NaN;
  });
  const baa = carry(months, monthlyMean(fred.BAA10Y ?? []), 1);
  const baaRise = baa.map((v, i) => {
    if (i < 12) return NaN;
    const low = Math.min(...baa.slice(i - 12, i + 1).filter(Number.isFinite));
    return v - low;
  });
  const trendGap = spx.map((v, i) => {
    if (i < 9) return NaN;
    const w = spx.slice(i - 9, i + 1).filter(Number.isFinite);
    return w.length === 10 ? (100 * (v - w.reduce((a, b) => a + b, 0) / 10)) / (w.reduce((a, b) => a + b, 0) / 10) : NaN;
  });
  const sahm = carry(months, new Map((fred.SAHMREALTIME ?? []).map((o) => [o.date.slice(0, 7), o.value])), 1);
  const curveInvertedRecently = curve.map((_, i) => curve.slice(Math.max(0, i - 24), i).some((v) => v <= 0));

  const s: Series = { months, spx, cape, ecy, buffett, marginYoY, curve, fed, fedChg24, baa, baaRise, trendGap, sahm, curveInvertedRecently };

  // Levels per signal per month; a signal with no data that month is left out of the score.
  const levels: Record<string, (Level | null)[]> = {};
  for (const sig of SIGNALS) {
    const vals = sig.value(s);
    levels[sig.id] = months.map((_, i) => (Number.isFinite(vals[i]) ? sig.level(i, s) : null));
  }
  const groupScore = (g: string, i: number) => {
    const ls = SIGNALS.filter((x) => x.group === g).map((x) => levels[x.id][i]).filter((l): l is Level => l != null);
    return ls.length ? (100 * ls.reduce<number>((a, b) => a + b, 0)) / (2 * ls.length) : NaN;
  };
  const groups = Object.fromEntries(GROUPS.map((g) => [g.id, months.map((_, i) => groupScore(g.id, i))]));
  // Warning-light score: share of all lights that are on (flashing counts double).
  const score = months.map((_, i) => {
    const ls = SIGNALS.map((x) => levels[x.id][i]).filter((l): l is Level => l != null);
    return ls.length >= 6 ? (100 * ls.reduce<number>((a, b) => a + b, 0)) / (2 * ls.length) : NaN;
  });
  const phase = months.map((_, i) => phaseOf(groups.fuel[i], groups.cracks[i]));

  // Trim the 24-month warm-up.
  const from = months.indexOf(start);
  const cut = <T,>(a: T[]) => a.slice(from);
  const out = {
    months: cut(months),
    score: cut(score).map((v) => Math.round(v * 10) / 10),
    phase: cut(phase),
    groups: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, cut(v).map((x) => Math.round(x * 10) / 10)])),
    series: {
      spx: cut(spx), cape: cut(cape), ecy: cut(ecy), buffett: cut(buffett), marginYoY: cut(marginYoY),
      curve: cut(curve), fed: cut(fed), fedChg24: cut(fedChg24), baa: cut(baa), baaRise: cut(baaRise),
      trendGap: cut(trendGap), sahm: cut(sahm),
    },
    levels: Object.fromEntries(Object.entries(levels).map(([k, v]) => [k, cut(v)])),
  };

  // Backtest: for each phase, how often did the S&P fall 15%+ at some point in the next 12 months?
  const fwdDrawdown = out.series.spx.map((p, i) => {
    const ahead = out.series.spx.slice(i + 1, i + 13).filter(Number.isFinite);
    return ahead.length >= 12 ? (100 * (Math.min(...ahead) - p)) / p : NaN;
  });
  const byPhase = (Object.keys(PHASES) as PhaseKey[]).map((k) => {
    const d = fwdDrawdown.filter((v, i) => Number.isFinite(v) && out.phase[i] === k);
    return { key: k, months: d.length, fell15: d.length ? d.filter((x) => x <= -15).length / d.length : NaN, avgWorst: d.length ? d.reduce((a, b) => a + b, 0) / d.length : NaN };
  });
  const allD = fwdDrawdown.filter(Number.isFinite);
  const idx = (m: string) => out.months.indexOf(m);
  const tops = TOPS.filter((t) => idx(t.month) >= 0).map((t) => {
    const i = idx(t.month);
    const ph = (d: number) => out.phase[i + d] ?? null;
    return { ...t, score: out.score[i], before6: ph(-6), atPeak: ph(0), after3: ph(3) };
  });
  const backtest = { byPhase, base: allD.length ? allD.filter((x) => x <= -15).length / allD.length : NaN, tops, since: out.months[0] };

  const last = out.months.length - 1;
  const current = {
    month: out.months[last],
    score: out.score[last],
    phase: out.phase[last],
    groups: Object.fromEntries(GROUPS.map((g) => [g.id, out.groups[g.id][last]])),
    signals: SIGNALS.map((sig) => {
      const vals = sig.value(s).slice(from);
      // Latest month with data for this signal (monthly sources lag by different amounts).
      let j = last;
      while (j > 0 && !Number.isFinite(vals[j])) j--;
      return { id: sig.id, group: sig.group, name: sig.name, unit: sig.unit, decimals: sig.decimals, rule: sig.rule, why: sig.why, value: vals[j], asOf: out.months[j], level: out.levels[sig.id][j] ?? 0 };
    }),
  };
  return { ...out, backtest, current };
}

export const TOPS_FRED_IDS = ["T10Y2Y", "FEDFUNDS", "BAA10Y", "SAHMREALTIME", "NCBEILQ027S", "GDP", "SP500", "DFII10"];

/** Load every input; a failed source comes back empty and is listed in `missing`. */
export async function loadTopsInputs() {
  const missing: string[] = [];
  const soft = <T,>(label: string, p: Promise<T[]>) => p.catch((err) => { console.error(`[tops] ${label}:`, err); missing.push(label); return [] as T[]; });
  const [shiller, margin, fred] = await Promise.all([
    getShiller().catch(async (err) => {
      console.error("[tops] Shiller, trying multpl fallback:", err);
      return soft("CAPE data (Shiller and multpl)", getShillerFallback());
    }),
    soft("FINRA margin debt", getMarginDebt()),
    fredMany(TOPS_FRED_IDS, "1985-01-01"),
  ]);
  return { shiller, margin, fred, missing };
}
