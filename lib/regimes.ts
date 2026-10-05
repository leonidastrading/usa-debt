// Regime classifier: turns daily market data into transparent 0–100 stress scores.
//
// Each regime is a weighted average of trailing z-scores (3-year window, no look-ahead)
// of a handful of features. The composite is mapped to 0–100 with a normal CDF after
// dividing by the composite's own historical standard deviation, so 50 = a typical
// day, 84 ≈ one sigma, 98 ≈ two sigma.
import type { Obs } from "./fred.ts";
import { asOf, clip, coalesce, diff, lastFinite, normCdf, pctChange, rollingStd, rollingZ, scale, std, sub } from "./stats.ts";

export const FRED_IDS = [
  "DGS3MO", "DGS2", "DGS10", "DGS30", "T10YIE", "DFII10", "THREEFYTP10", "DTWEXBGS",
  "SOFR", "IORB", "IOER", "RRPONTSYD", "WTREGEN", "BAMLH0A0HYM2", "VIXCLS", "SP500", "BAA10Y",
] as const;

export type FredData = Record<string, Obs[]>;

export const Z_WINDOW = 756; // ~3 trading years
const LAG = 20; // ~1 trading month

export type Frame = { dates: string[]; col: (id: string, staleDays?: number) => number[] };

export function buildFrame(data: FredData): Frame {
  const dates = (data.DGS10 ?? []).map((o) => o.date);
  const cache = new Map<string, number[]>();
  return {
    dates,
    col(id, staleDays = 10) {
      const key = `${id}:${staleDays}`;
      if (!cache.has(key)) cache.set(key, asOf(data[id] ?? [], dates, staleDays));
      return cache.get(key)!;
    },
  };
}

// ---------- Features ----------

export type FeatureDef = {
  id: string;
  label: string;
  unit: string;
  compute: (f: Frame) => number[];
};

const bp = (a: number[]) => scale(a, 100);

export const FEATURES: FeatureDef[] = [
  { id: "y10_20d", label: "10Y yield, 1-month change", unit: "bp", compute: (f) => bp(diff(f.col("DGS10"), LAG)) },
  { id: "y30_20d", label: "30Y yield, 1-month change", unit: "bp", compute: (f) => bp(diff(f.col("DGS30"), LAG)) },
  { id: "y2_20d", label: "2Y yield, 1-month change", unit: "bp", compute: (f) => bp(diff(f.col("DGS2"), LAG)) },
  { id: "tp_20d", label: "10Y term premium, 1-month change", unit: "bp", compute: (f) => bp(diff(f.col("THREEFYTP10"), LAG)) },
  { id: "be_20d", label: "10Y breakeven, 1-month change", unit: "bp", compute: (f) => bp(diff(f.col("T10YIE"), LAG)) },
  { id: "real_20d", label: "10Y real yield, 1-month change", unit: "bp", compute: (f) => bp(diff(f.col("DFII10"), LAG)) },
  { id: "steep_20d", label: "2s10s curve, 1-month change", unit: "bp", compute: (f) => bp(diff(sub(f.col("DGS10"), f.col("DGS2")), LAG)) },
  { id: "usd_20d", label: "Broad dollar, 1-month change", unit: "%", compute: (f) => pctChange(f.col("DTWEXBGS"), LAG) },
  // FRED only keeps 3 years of the ICE high-yield index, so the scored credit feature uses
  // Moody's Baa – 10Y spread, which goes back decades. The HY spread is still shown as a tile.
  { id: "credit_20d", label: "Baa credit spread, 1-month change", unit: "bp", compute: (f) => bp(diff(f.col("BAA10Y"), LAG)) },
  { id: "vix_lvl", label: "VIX level", unit: "", compute: (f) => f.col("VIXCLS") },
  {
    id: "rv10",
    label: "10Y realized vol (MOVE proxy)",
    unit: "bp/yr",
    compute: (f) => scale(rollingStd(bp(diff(f.col("DGS10"), 1)), 20, 15), Math.sqrt(252)),
  },
  {
    id: "funding",
    label: "SOFR minus IORB",
    unit: "bp",
    compute: (f) => bp(sub(f.col("SOFR", 5), coalesce(f.col("IORB", 5), f.col("IOER", 5)))),
  },
  { id: "spx_20d", label: "S&P 500, 1-month change", unit: "%", compute: (f) => pctChange(f.col("SP500", 5), LAG) },
];

// ---------- Regimes ----------

export type RegimeDef = {
  id: string;
  name: string;
  tagline: string;
  description: string;
  weights: { feature: string; w: number }[];
};

export const REGIMES: RegimeDef[] = [
  {
    id: "fiscal",
    name: "Fiscal stress",
    tagline: "“Sell America”: yields up, term premium up, dollar down",
    description:
      "Investors demand more to hold long-dated Treasuries and the dollar weakens at the same time. " +
      "This is the debt-sustainability signature: 2023 Q3, April 2025, the UK in 2022.",
    weights: [
      { feature: "tp_20d", w: 1.5 },
      { feature: "y30_20d", w: 1 },
      { feature: "y10_20d", w: 0.75 },
      { feature: "usd_20d", w: -1 },
      { feature: "steep_20d", w: 0.5 },
      { feature: "be_20d", w: 0.25 },
    ],
  },
  {
    id: "liquidity",
    name: "Liquidity stress",
    tagline: "“Dash for cash”: rate vol up, spreads wide, dollar up",
    description:
      "Market plumbing strains: Treasury volatility spikes, credit spreads gap wider, funding rates print above " +
      "the Fed's floor and everyone wants dollars. March 2020, September 2019 repo, Lehman.",
    weights: [
      { feature: "rv10", w: 1.5 },
      { feature: "credit_20d", w: 1 },
      { feature: "vix_lvl", w: 1 },
      { feature: "funding", w: 1 },
      { feature: "usd_20d", w: 0.5 },
    ],
  },
  {
    id: "inflation",
    name: "Inflation scare",
    tagline: "Breakevens and front-end yields up together",
    description:
      "The market prices more inflation and more Fed hikes. Bonds and stocks can fall together, " +
      "which breaks the usual hedge. 2021–22 is the template.",
    weights: [
      { feature: "be_20d", w: 1.5 },
      { feature: "y2_20d", w: 1 },
      { feature: "y10_20d", w: 0.5 },
      { feature: "real_20d", w: -0.5 },
    ],
  },
  {
    id: "growth",
    name: "Growth scare",
    tagline: "Flight to quality: yields down, stocks down, spreads wider",
    description:
      "Classic risk-off. Treasuries rally as equities and credit sell off. Bonds work as a hedge here; " +
      "this is the regime SPX put spreads are built for.",
    weights: [
      { feature: "y10_20d", w: -1 },
      { feature: "spx_20d", w: -1 },
      { feature: "credit_20d", w: 1 },
      { feature: "vix_lvl", w: 1 },
      { feature: "be_20d", w: -0.5 },
    ],
  },
];

export const LEVELS = [
  { min: 95, key: "alert", label: "Alert", status: "critical" },
  { min: 85, key: "elevated", label: "Elevated", status: "serious" },
  { min: 70, key: "watch", label: "Watch", status: "warning" },
  { min: 0, key: "calm", label: "Calm", status: "good" },
] as const;

export function levelFor(score: number) {
  return LEVELS.find((l) => score >= l.min) ?? LEVELS[LEVELS.length - 1];
}

// ---------- Calibration events ----------

export const EVENTS = [
  { date: "2008-09-15", label: "Lehman", expect: "liquidity" },
  { date: "2011-08-05", label: "US downgrade", expect: "growth" },
  { date: "2013-06-24", label: "Taper tantrum", expect: "fiscal" },
  { date: "2019-09-17", label: "Repo spike", expect: "liquidity" },
  { date: "2020-03-16", label: "Covid dash for cash", expect: "liquidity" },
  { date: "2022-06-13", label: "Inflation shock", expect: "inflation" },
  { date: "2022-09-28", label: "UK gilt crisis", expect: "fiscal" },
  { date: "2023-03-13", label: "SVB", expect: "liquidity" },
  { date: "2023-10-19", label: "10Y hits 5%", expect: "fiscal" },
  { date: "2025-04-09", label: "Tariff selloff", expect: "fiscal" },
] as const;

// ---------- Computation ----------

export type Contribution = { feature: string; label: string; unit: string; raw: number; z: number; weight: number; contribution: number };

export type RegimeResult = {
  id: string;
  name: string;
  tagline: string;
  description: string;
  score: number;
  change20d: number;
  level: ReturnType<typeof levelFor>;
  contributions: Contribution[];
  /** Share of days since history start with score ≥ 95 (alert frequency). */
  alertRate: number;
};

export type RegimeOutput = {
  asOf: string;
  regimes: RegimeResult[];
  /** Weekly-sampled history for charts: dates + one score array per regime. */
  history: { dates: string[]; scores: Record<string, number[]> };
  events: { date: string; label: string; expect: string; peaks: Record<string, number> }[];
};

export function computeRegimes(data: FredData): RegimeOutput {
  const frame = buildFrame(data);
  const n = frame.dates.length;
  const raw: Record<string, number[]> = {};
  const z: Record<string, number[]> = {};
  for (const f of FEATURES) {
    raw[f.id] = f.compute(frame);
    z[f.id] = rollingZ(raw[f.id], Z_WINDOW);
  }

  const scores: Record<string, number[]> = {};
  const results: RegimeResult[] = [];
  for (const r of REGIMES) {
    const totalW = r.weights.reduce((s, w) => s + Math.abs(w.w), 0);
    const comp = new Array<number>(n).fill(NaN);
    for (let i = 0; i < n; i++) {
      let s = 0, used = 0;
      for (const { feature, w } of r.weights) {
        const v = z[feature][i];
        if (Number.isFinite(v)) { s += w * clip(v, -4, 4); used += Math.abs(w); }
      }
      if (used >= 0.5 * totalW) comp[i] = s / used;
    }
    const sd = std(comp) || 1;
    const sc = comp.map((c) => (Number.isFinite(c) ? 100 * normCdf(c / sd) : NaN));
    scores[r.id] = sc;

    const last = lastFinite(sc);
    const i = last.index;
    const contributions: Contribution[] = r.weights.map(({ feature, w }) => {
      const def = FEATURES.find((f) => f.id === feature)!;
      const zi = i >= 0 ? z[feature][i] : NaN;
      return {
        feature,
        label: def.label,
        unit: def.unit,
        raw: i >= 0 ? raw[feature][i] : NaN,
        z: zi,
        weight: w,
        contribution: Number.isFinite(zi) ? (w * clip(zi, -4, 4)) / totalW : NaN,
      };
    });
    const valid = sc.filter(Number.isFinite);
    results.push({
      id: r.id,
      name: r.name,
      tagline: r.tagline,
      description: r.description,
      score: last.value,
      change20d: i >= LAG ? last.value - sc[i - LAG] : NaN,
      level: levelFor(last.value),
      contributions,
      alertRate: valid.length ? valid.filter((v) => v >= 95).length / valid.length : NaN,
    });
  }

  // Weekly sample (every 5th trading day, always including the last day) for the chart.
  const idx: number[] = [];
  for (let i = n - 1; i >= 0; i -= 5) idx.unshift(i);
  const history = {
    dates: idx.map((i) => frame.dates[i]),
    scores: Object.fromEntries(
      Object.entries(scores).map(([k, v]) => [k, idx.map((i) => (Number.isFinite(v[i]) ? Math.round(v[i] * 10) / 10 : NaN))]),
    ),
  };

  // Peak score of each regime within ±10 trading days of each calibration event.
  const events = EVENTS.filter((e) => e.date >= frame.dates[0]).map((e) => {
    const c = frame.dates.findIndex((d) => d >= e.date);
    const peaks: Record<string, number> = {};
    for (const r of REGIMES) {
      let m = NaN;
      for (let i = Math.max(0, c - 10); i <= Math.min(n - 1, c + 10) && c >= 0; i++) {
        const v = scores[r.id][i];
        if (Number.isFinite(v) && !(m >= v)) m = v;
      }
      peaks[r.id] = m;
    }
    return { date: e.date, label: e.label, expect: e.expect as string, peaks };
  });

  return { asOf: frame.dates[n - 1] ?? "", regimes: results, history, events };
}

// ---------- Indicator tiles ----------

export type IndicatorDef = {
  id: string;
  label: string;
  unit: string;
  decimals: number;
  /** Multiply the change by this to display it (e.g. 100 for % → bp). */
  changeScale: number;
  changeUnit: string;
  /** +1 if a rise is risk-on-the-bond-market, -1 if a fall is. */
  riskSign: 1 | -1;
  why: string;
  value: (f: Frame) => number[];
  staleDays?: number;
};

export const INDICATORS: IndicatorDef[] = [
  { id: "DGS10", label: "10Y Treasury yield", unit: "%", decimals: 2, changeScale: 100, changeUnit: "bp", riskSign: 1, why: "The benchmark price of US government money.", value: (f) => f.col("DGS10") },
  { id: "DGS30", label: "30Y Treasury yield", unit: "%", decimals: 2, changeScale: 100, changeUnit: "bp", riskSign: 1, why: "Where fiscal worries show first: the long end has to absorb duration supply.", value: (f) => f.col("DGS30") },
  { id: "THREEFYTP10", label: "10Y term premium", unit: "%", decimals: 2, changeScale: 100, changeUnit: "bp", riskSign: 1, why: "Extra yield demanded for holding duration (Kim–Wright, Fed Board). Rising = buyers want compensation for fiscal/inflation risk.", value: (f) => f.col("THREEFYTP10") },
  { id: "T10YIE", label: "10Y breakeven inflation", unit: "%", decimals: 2, changeScale: 100, changeUnit: "bp", riskSign: 1, why: "Market-implied inflation. Up with yields = inflation story; flat = real-rate/term-premium story.", value: (f) => f.col("T10YIE") },
  { id: "DFII10", label: "10Y real yield (TIPS)", unit: "%", decimals: 2, changeScale: 100, changeUnit: "bp", riskSign: 1, why: "The real cost of capital. Sustained highs pressure equities and debt service.", value: (f) => f.col("DFII10") },
  { id: "CURVE", label: "2s10s curve", unit: "bp", decimals: 0, changeScale: 1, changeUnit: "bp", riskSign: 1, why: "Bear steepening (long end leading higher) is the fiscal-stress shape.", value: (f) => bp(sub(f.col("DGS10"), f.col("DGS2"))) },
  { id: "DTWEXBGS", label: "Broad dollar index", unit: "", decimals: 1, changeScale: 1, changeUnit: "", riskSign: -1, why: "Yields up with the dollar down = foreign buyers stepping back.", value: (f) => f.col("DTWEXBGS") },
  { id: "BAMLH0A0HYM2", label: "High-yield credit spread", unit: "%", decimals: 2, changeScale: 100, changeUnit: "bp", riskSign: 1, why: "Credit stress transmits to funding markets and risk appetite.", value: (f) => f.col("BAMLH0A0HYM2") },
  { id: "VIXCLS", label: "VIX", unit: "", decimals: 1, changeScale: 1, changeUnit: "pts", riskSign: 1, why: "Equity implied vol. Drives what your SPX hedges cost.", value: (f) => f.col("VIXCLS") },
  { id: "RV10", label: "10Y realized vol", unit: "bp", decimals: 0, changeScale: 1, changeUnit: "bp", riskSign: 1, why: "Free stand-in for the MOVE index: annualized volatility of daily 10Y changes over 20 days.", value: (f) => FEATURES.find((x) => x.id === "rv10")!.compute(f) },
  { id: "FUNDING", label: "SOFR − IORB", unit: "bp", decimals: 0, changeScale: 1, changeUnit: "bp", riskSign: 1, why: "Repo trading above the Fed's interest on reserves = reserves getting scarce (Sept 2019 signature).", value: (f) => FEATURES.find((x) => x.id === "funding")!.compute(f) },
  { id: "RRPONTSYD", label: "Fed reverse repo", unit: "$bn", decimals: 0, changeScale: 1, changeUnit: "$bn", riskSign: -1, why: "Excess cash parked at the Fed. Near zero means the liquidity buffer is gone.", value: (f) => f.col("RRPONTSYD", 5) },
  { id: "WTREGEN", label: "Treasury cash (TGA)", unit: "$bn", decimals: 0, changeScale: 1, changeUnit: "$bn", riskSign: 1, why: "A rising TGA drains reserves from the banking system; watch around debt-ceiling deals.", value: (f) => scale(f.col("WTREGEN", 14), 1 / 1000), staleDays: 14 },
];

export type IndicatorTile = {
  id: string;
  label: string;
  unit: string;
  decimals: number;
  why: string;
  value: number;
  date: string;
  change20d: number;
  changeUnit: string;
  /** z-score of the 1-month change vs the last 3 years, signed so positive = more risk. */
  riskZ: number;
  spark: number[];
};

export function computeIndicators(data: FredData): IndicatorTile[] {
  const frame = buildFrame(data);
  return INDICATORS.map((d) => {
    const v = d.value(frame);
    const last = lastFinite(v);
    const ch = diff(v, LAG);
    const zc = rollingZ(ch, Z_WINDOW);
    const start = Math.max(0, last.index - 260);
    const spark: number[] = [];
    for (let i = start; i <= last.index; i += 2) spark.push(v[i]);
    return {
      id: d.id,
      label: d.label,
      unit: d.unit,
      decimals: d.decimals,
      why: d.why,
      value: last.value,
      date: frame.dates[last.index] ?? "",
      change20d: last.index >= 0 ? ch[last.index] * d.changeScale : NaN,
      changeUnit: d.changeUnit,
      riskZ: last.index >= 0 ? zc[last.index] * d.riskSign : NaN,
      spark,
    };
  });
}

/** Latest point on the curve, for the scenario engine. */
export function currentCurve(data: FredData) {
  const last = (id: string) => {
    const s = data[id] ?? [];
    return s.length ? s[s.length - 1].value : NaN;
  };
  return { m3: last("DGS3MO"), y2: last("DGS2"), y10: last("DGS10"), y30: last("DGS30"), spx: last("SP500"), vix: last("VIXCLS") };
}
