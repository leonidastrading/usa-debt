// Bond price indices from constant-maturity Treasury yields.
//
// Each day, yesterday's par bond (coupon = yesterday's yield) is repriced at today's
// yield; chaining those daily price changes gives the price path of a bond held at a
// constant maturity — roughly what a 2Y / 10Y / 30Y Treasury fund's price does,
// excluding coupon income. 100 = the first observation.
import type { Obs } from "./fred.ts";

/** Price per 100 face of a semiannual bond: coupon c and yield y in %, n years to maturity. */
export function bondPrice(c: number, y: number, n: number): number {
  const periods = 2 * n;
  const r = y / 200;
  if (Math.abs(r) < 1e-9) return c / 2 * periods + 100;
  const disc = (1 + r) ** -periods;
  return (c / 2) * ((1 - disc) / r) + 100 * disc;
}

export function priceIndex(yields: Obs[], years: number): Obs[] {
  if (!yields.length) return [];
  const out: Obs[] = [{ date: yields[0].date, value: 100 }];
  let level = 100;
  for (let i = 1; i < yields.length; i++) {
    const prev = yields[i - 1].value;
    level *= bondPrice(prev, yields[i].value, years) / 100;
    out.push({ date: yields[i].date, value: level });
  }
  return out;
}
