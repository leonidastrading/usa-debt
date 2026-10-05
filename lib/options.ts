// Black–Scholes pricing for stress-testing SPX option positions under scenarios.
import { normCdf } from "./stats.ts";

export type OptionLeg = {
  id: string;
  kind: "put" | "call";
  strike: number;
  /** ISO date. */
  expiry: string;
  /** Contracts; positive = long, negative = short. */
  qty: number;
  /** Price paid (+) or received (−) per unit, for P&L vs entry. Optional. */
  entry?: number;
};

export const SPX_MULTIPLIER = 100;

export function bsPrice(kind: "put" | "call", S: number, K: number, T: number, r: number, q: number, vol: number): number {
  if (T <= 0 || vol <= 0) return Math.max(0, kind === "call" ? S - K : K - S);
  const sq = vol * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + 0.5 * vol * vol) * T) / sq;
  const d2 = d1 - sq;
  if (kind === "call") return S * Math.exp(-q * T) * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2);
  return K * Math.exp(-r * T) * normCdf(-d2) - S * Math.exp(-q * T) * normCdf(-d1);
}

/**
 * Simple sticky-moneyness skew: OTM puts carry more vol than ATM.
 * vol(K) = atm × (1 + skew × ln(S/K)), floored at 40% of ATM.
 */
export function skewVol(atm: number, S: number, K: number, skew: number): number {
  return Math.max(atm * 0.4, atm * (1 + skew * Math.log(S / K)));
}

export type MarketState = {
  spot: number;
  atmVol: number; // decimal, e.g. 0.16
  rate: number; // decimal
  divYield: number; // decimal
  skew: number;
  /** Valuation date, ISO. */
  asOf: string;
};

const yearsBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / (365.25 * 86400000);

export function legValue(leg: OptionLeg, m: MarketState): number {
  const T = Math.max(0, yearsBetween(m.asOf, leg.expiry));
  const vol = skewVol(m.atmVol, m.spot, leg.strike, m.skew);
  return bsPrice(leg.kind, m.spot, leg.strike, T, m.rate, m.divYield, vol);
}

/** Portfolio market value in dollars. */
export function portfolioValue(legs: OptionLeg[], m: MarketState): number {
  return legs.reduce((s, l) => s + l.qty * SPX_MULTIPLIER * legValue(l, m), 0);
}

export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * 86400000).toISOString().slice(0, 10);
}

/** P&L grid: rows = spot moves (%), columns = vol multipliers, after `days` have passed. */
export function stressGrid(legs: OptionLeg[], m: MarketState, moves: number[], volMults: number[], days: number) {
  const base = portfolioValue(legs, m);
  const asOf = addDays(m.asOf, days);
  return moves.map((mv) =>
    volMults.map((vm) => portfolioValue(legs, { ...m, asOf, spot: m.spot * (1 + mv / 100), atmVol: m.atmVol * vm }) - base),
  );
}
