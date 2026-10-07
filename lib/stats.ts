// Small numeric helpers. Arrays use NaN for "missing".
import type { Obs } from "./fred.ts";

const DAY = 86400000;
const t = (d: string) => Date.parse(d + "T00:00:00Z");

/** Value of `series` as of each date in `dates`, carried forward at most `maxStaleDays`. */
export function asOf(series: Obs[], dates: string[], maxStaleDays = 10): number[] {
  const out = new Array<number>(dates.length).fill(NaN);
  let j = -1;
  for (let i = 0; i < dates.length; i++) {
    const ti = t(dates[i]);
    while (j + 1 < series.length && t(series[j + 1].date) <= ti) j++;
    if (j >= 0 && ti - t(series[j].date) <= maxStaleDays * DAY) out[i] = series[j].value;
  }
  return out;
}

export function diff(a: number[], lag: number): number[] {
  return a.map((v, i) => (i >= lag ? v - a[i - lag] : NaN));
}

export function pctChange(a: number[], lag: number): number[] {
  return a.map((v, i) => (i >= lag && a[i - lag] ? (100 * (v - a[i - lag])) / a[i - lag] : NaN));
}

export function sub(a: number[], b: number[]): number[] {
  return a.map((v, i) => v - b[i]);
}

export function scale(a: number[], k: number): number[] {
  return a.map((v) => v * k);
}

/** Fill NaN in `a` from `b` element-wise. */
export function coalesce(a: number[], b: number[]): number[] {
  return a.map((v, i) => (Number.isFinite(v) ? v : b[i]));
}

/** Rolling standard deviation of a series over `window` observations (NaN-aware). */
export function rollingStd(a: number[], window: number, minObs = Math.ceil(window * 0.7)): number[] {
  const out = new Array<number>(a.length).fill(NaN);
  let n = 0, s = 0, ss = 0;
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    if (Number.isFinite(v)) { n++; s += v; ss += v * v; }
    if (i >= window) {
      const o = a[i - window];
      if (Number.isFinite(o)) { n--; s -= o; ss -= o * o; }
    }
    if (n >= minObs) {
      const m = s / n;
      out[i] = Math.sqrt(Math.max(0, ss / n - m * m));
    }
  }
  return out;
}

/**
 * Trailing z-score: (x - mean) / sd over the previous `window` observations.
 * Only uses data up to and including t, so it can be backtested without look-ahead.
 */
export function rollingZ(a: number[], window: number, minObs = 250): number[] {
  const out = new Array<number>(a.length).fill(NaN);
  let n = 0, s = 0, ss = 0;
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    if (Number.isFinite(v)) { n++; s += v; ss += v * v; }
    if (i >= window) {
      const o = a[i - window];
      if (Number.isFinite(o)) { n--; s -= o; ss -= o * o; }
    }
    if (n >= minObs && Number.isFinite(v)) {
      const m = s / n;
      const sd = Math.sqrt(Math.max(0, ss / n - m * m));
      out[i] = sd > 1e-12 ? (v - m) / sd : 0;
    }
  }
  return out;
}

export function clip(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26, |err| < 1.5e-7). */
export function normCdf(x: number): number {
  const s = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const k = 1 / (1 + 0.3275911 * z);
  const y = 1 - ((((1.061405429 * k - 1.453152027) * k + 1.421413741) * k - 0.284496736) * k + 0.254829592) * k * Math.exp(-z * z);
  return 0.5 * (1 + s * y);
}

export function lastFinite(a: number[]): { value: number; index: number } {
  for (let i = a.length - 1; i >= 0; i--) if (Number.isFinite(a[i])) return { value: a[i], index: i };
  return { value: NaN, index: -1 };
}

export function mean(a: number[]): number {
  let n = 0, s = 0;
  for (const v of a) if (Number.isFinite(v)) { n++; s += v; }
  return n ? s / n : NaN;
}

export function std(a: number[]): number {
  const m = mean(a);
  let n = 0, s = 0;
  for (const v of a) if (Number.isFinite(v)) { n++; s += (v - m) ** 2; }
  return n > 1 ? Math.sqrt(s / (n - 1)) : NaN;
}

/** Pearson correlation over the indices where both arrays are finite; NaN if fewer than `minN`. */
export function correlation(a: number[], b: number[], from = 0, minN = 30): number {
  let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  for (let i = Math.max(0, from); i < Math.min(a.length, b.length); i++) {
    const x = a[i], y = b[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    n++; sa += x; sb += y; saa += x * x; sbb += y * y; sab += x * y;
  }
  if (n < minN) return NaN;
  const cov = sab / n - (sa / n) * (sb / n);
  const va = saa / n - (sa / n) ** 2, vb = sbb / n - (sb / n) ** 2;
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : NaN;
}
