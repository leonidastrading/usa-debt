// Debt rollover model: projects federal interest cost under rate scenarios using the
// actual maturity schedule of marketable Treasury debt (MSPD table 3).
//
// Simplifications (deliberate, so the output is easy to reason about):
// - Annual steps. Debt maturing in year k is refinanced at the start of year k;
//   the year's deficit is borrowed evenly through the year (mid-year convention).
// - Bills and FRNs reprice every year at the scenario's short rate.
// - New borrowing (refinancing + deficit) is issued across a fixed tenor mix.
// - Interest = Σ outstanding × coupon. No inflation accretion on TIPS, no Fed remittances.
import type { MaturityProfile } from "./treasury.ts";

export type Curve = { m3: number; y2: number; y10: number; y30: number };

export type Scenario = {
  id: string;
  name: string;
  description: string;
  /** Shift in bp applied to [3M, 2Y, 10Y, 30Y], reached linearly over `rampYears`. */
  shiftBp: [number, number, number, number];
  rampYears: number;
  /** Primary deficit (excluding interest) as % of GDP. */
  primaryDeficitPct: number;
  /** Nominal GDP growth, %/yr. */
  nominalGrowthPct: number;
};

export const SCENARIOS: Scenario[] = [
  { id: "frozen", name: "Rates frozen", description: "Today's curve held for 10 years. The baseline: higher costs just from rolling old cheap debt.", shiftBp: [0, 0, 0, 0], rampYears: 1, primaryDeficitPct: 3, nominalGrowthPct: 4 },
  { id: "cuts", name: "Fed cuts", description: "Soft landing: front end −150bp, long end −50bp over two years.", shiftBp: [-150, -100, -50, -25], rampYears: 2, primaryDeficitPct: 3, nominalGrowthPct: 4 },
  { id: "parallel", name: "Parallel +2%", description: "Every maturity 200bp higher within a year.", shiftBp: [200, 200, 200, 200], rampYears: 1, primaryDeficitPct: 3, nominalGrowthPct: 4 },
  { id: "steepener", name: "Bear steepener", description: "Term premium blowout: long end +200bp, front end barely moves.", shiftBp: [25, 75, 150, 200], rampYears: 2, primaryDeficitPct: 3, nominalGrowthPct: 4 },
  { id: "crisis", name: "Fiscal crisis", description: "Buyers strike: long rates +300bp, recession widens the deficit to 5% and slows growth.", shiftBp: [100, 150, 250, 300], rampYears: 1, primaryDeficitPct: 5, nominalGrowthPct: 3 },
  { id: "stagflation", name: "Stagflation", description: "Inflation forces the Fed up 200bp; nominal growth runs hot at 5.5%.", shiftBp: [200, 200, 175, 150], rampYears: 2, primaryDeficitPct: 4, nominalGrowthPct: 5.5 },
];

/** Tenors (years) new debt is issued at, and default share of gross issuance. */
export const ISSUANCE_TENORS = [1, 3, 7, 10, 25];
export const DEFAULT_MIX = [0.3, 0.3, 0.2, 0.12, 0.08];

/** Linear interpolation of the curve at `years`. */
export function rateAt(c: Curve, years: number): number {
  const pts: [number, number][] = [[0.25, c.m3], [2, c.y2], [10, c.y10], [30, c.y30]];
  if (years <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    if (years <= x1) return y0 + ((y1 - y0) * (years - x0)) / (x1 - x0);
  }
  return pts[pts.length - 1][1];
}

export function curveInYear(base: Curve, s: Scenario, year: number): Curve {
  const f = Math.min(1, year / Math.max(1, s.rampYears));
  return {
    m3: base.m3 + (f * s.shiftBp[0]) / 100,
    y2: base.y2 + (f * s.shiftBp[1]) / 100,
    y10: base.y10 + (f * s.shiftBp[2]) / 100,
    y30: base.y30 + (f * s.shiftBp[3]) / 100,
  };
}

export type YearRow = {
  year: number;
  debt: number;
  interest: number;
  avgRate: number; // %
  gdp: number;
  debtToGdp: number; // %
  interestToGdp: number; // %
  refinanced: number;
  deficit: number;
};

export type ProjectionInput = {
  profile: MaturityProfile;
  curve: Curve;
  scenario: Scenario;
  gdp: number; // $ annualized
  years?: number;
  mix?: number[];
};

type Cohort = { amount: number; rate: number; maturesYear: number; floating: boolean };

export function project({ profile, curve, scenario, gdp, years = 10, mix = DEFAULT_MIX }: ProjectionInput): YearRow[] {
  const mixSum = mix.reduce((a, b) => a + b, 0) || 1;
  const w = mix.map((m) => m / mixSum);

  // Initial stock. Bucket k matures during year k+1 (bucket 0 = within the next 12 months).
  let cohorts: Cohort[] = [];
  for (const b of profile.buckets) {
    const bill = b.amount * b.billShare;
    const fixed = b.amount - bill;
    if (bill > 0) cohorts.push({ amount: bill, rate: b.rate, maturesYear: b.yearIndex + 1, floating: true });
    if (fixed > 0) cohorts.push({ amount: fixed, rate: b.rate, maturesYear: b.yearIndex + 1, floating: false });
  }

  let nominalGdp = gdp;
  const rows: YearRow[] = [];
  for (let y = 1; y <= years; y++) {
    const c = curveInYear(curve, scenario, y);
    nominalGdp *= 1 + scenario.nominalGrowthPct / 100;

    // Refinance what matures this year; reprice floating debt at the short rate.
    let maturing = 0;
    const keep: Cohort[] = [];
    for (const k of cohorts) {
      if (k.maturesYear <= y) maturing += k.amount;
      else keep.push(k.floating ? { ...k, rate: c.m3 } : k);
    }
    cohorts = keep;

    // Maturing debt is refinanced at the start of the year; the deficit (primary + interest)
    // is borrowed evenly through the year, so on average it accrues half a year of interest.
    //   interest = existing + maturing·r + ½·r·(primary + interest)
    const blendedNew = ISSUANCE_TENORS.reduce((s, ten, i) => s + w[i] * rateAt(c, ten), 0);
    const r = blendedNew / 100;
    const primary = (scenario.primaryDeficitPct / 100) * nominalGdp;
    const existingInterest = cohorts.reduce((s, k) => s + (k.amount * k.rate) / 100, 0);
    const interest = (existingInterest + maturing * r + 0.5 * r * primary) / (1 - 0.5 * r);
    const newIssue = maturing + primary + interest;

    ISSUANCE_TENORS.forEach((ten, i) => {
      if (w[i] <= 0) return;
      cohorts.push({ amount: newIssue * w[i], rate: rateAt(c, ten), maturesYear: y + ten, floating: ten <= 1 });
    });

    const debt = cohorts.reduce((s, k) => s + k.amount, 0);
    rows.push({
      year: y,
      debt,
      interest,
      avgRate: (100 * interest) / debt,
      gdp: nominalGdp,
      debtToGdp: (100 * debt) / nominalGdp,
      interestToGdp: (100 * interest) / nominalGdp,
      refinanced: maturing,
      deficit: primary + interest,
    });
  }
  return rows;
}

/** Interest on today's stock at today's coupons: the starting point for every scenario. */
export function currentInterest(profile: MaturityProfile): number {
  return profile.buckets.reduce((s, b) => s + (b.amount * b.rate) / 100, 0);
}
