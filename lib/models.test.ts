import assert from "node:assert/strict";
import { test } from "node:test";
import { parseFredCsv } from "./fred.ts";
import { parseRss } from "./news.ts";
import { bsPrice, portfolioValue, stressGrid } from "./options.ts";
import { project, rateAt, SCENARIOS } from "./rollover.ts";
import { asOf, normCdf, rollingZ } from "./stats.ts";
import { buildMaturityProfile } from "./treasury.ts";

test("normCdf matches known values", () => {
  assert.ok(Math.abs(normCdf(0) - 0.5) < 1e-7);
  assert.ok(Math.abs(normCdf(1.96) - 0.975) < 1e-3);
  assert.ok(Math.abs(normCdf(-1) - 0.1587) < 1e-3);
});

test("rollingZ uses only past data", () => {
  const a = Array.from({ length: 400 }, (_, i) => Math.sin(i / 7));
  const z1 = rollingZ(a, 300, 250);
  const z2 = rollingZ([...a, 1000], 300, 250);
  assert.equal(z1[399], z2[399]);
  assert.ok(Number.isNaN(z1[100]));
});

test("asOf carries values forward but not past the staleness limit", () => {
  const s = [{ date: "2024-01-01", value: 1 }, { date: "2024-01-10", value: 2 }];
  assert.deepEqual(asOf(s, ["2024-01-02", "2024-01-10", "2024-01-25"], 10), [1, 2, NaN]);
});

test("parseFredCsv skips missing values", () => {
  assert.deepEqual(parseFredCsv("observation_date,DGS10\n2024-01-01,.\n2024-01-02,4.1\n"), [{ date: "2024-01-02", value: 4.1 }]);
});

test("parseRss strips the Google News source suffix", () => {
  const xml = `<rss><channel><item><title>Yields jump - Reuters</title><link>https://x</link><pubDate>Mon, 05 Oct 2026 10:00:00 GMT</pubDate><source url="https://reuters.com">Reuters</source></item></channel></rss>`;
  const [item] = parseRss(xml, "yields");
  assert.equal(item.title, "Yields jump");
  assert.equal(item.source, "Reuters");
  assert.equal(item.published, "2026-10-05T10:00:00.000Z");
});

test("Black-Scholes put-call parity", () => {
  const S = 100, K = 95, T = 0.5, r = 0.04, q = 0.01, v = 0.2;
  const c = bsPrice("call", S, K, T, r, q, v);
  const p = bsPrice("put", S, K, T, r, q, v);
  assert.ok(Math.abs(c - p - (S * Math.exp(-q * T) - K * Math.exp(-r * T))) < 1e-9);
});

test("put spread gains in a selloff and is capped at its width", () => {
  const legs = [
    { id: "a", kind: "put" as const, strike: 5700, expiry: "2027-01-01", qty: 1 },
    { id: "b", kind: "put" as const, strike: 5100, expiry: "2027-01-01", qty: -1 },
  ];
  const m = { spot: 6000, atmVol: 0.16, rate: 0.04, divYield: 0.013, skew: 3, asOf: "2026-10-01" };
  const grid = stressGrid(legs, m, [-20, 0, 10], [1], 0);
  assert.ok(grid[0][0] > 0 && grid[2][0] < 0);
  assert.ok(portfolioValue(legs, { ...m, spot: 3000, asOf: "2999-01-01" }) <= 600 * 100 + 1e-6);
});

const profile = buildMaturityProfile(
  [
    { security_class1_desc: "Bills Maturity Value", security_class2_desc: "X", interest_rate_pct: "null", yield_pct: "4", maturity_date: "2026-12-01", outstanding_amt: "6000000" },
    { security_class1_desc: "Notes", security_class2_desc: "Y", interest_rate_pct: "3", yield_pct: "null", maturity_date: "2029-06-01", outstanding_amt: "14000000" },
    { security_class1_desc: "Total Marketable", security_class2_desc: "", interest_rate_pct: "null", yield_pct: "null", maturity_date: "null", outstanding_amt: "20000000" },
  ],
  "2026-08-31",
);

test("maturity profile buckets and skips totals", () => {
  assert.equal(profile.totalMarketable, 20e12);
  assert.equal(profile.buckets[0].yearIndex, 0);
  assert.equal(profile.buckets[0].billShare, 1);
  assert.equal(profile.buckets[1].yearIndex, 2);
});

test("rateAt interpolates the curve", () => {
  const c = { m3: 4, y2: 4, y10: 5, y30: 6 };
  assert.equal(rateAt(c, 6), 4.5);
  assert.equal(rateAt(c, 20), 5.5);
});

test("higher rates mean a higher interest bill", () => {
  const curve = { m3: 4, y2: 4, y10: 4.5, y30: 5 };
  const run = (id: string) => project({ profile, curve, scenario: SCENARIOS.find((s) => s.id === id)!, gdp: 30e12 });
  const frozen = run("frozen"), parallel = run("parallel"), cuts = run("cuts");
  assert.ok(parallel[9].interest > frozen[9].interest);
  assert.ok(cuts[9].interest < frozen[9].interest);
  // Debt grows by roughly the deficit each year.
  assert.ok(frozen[0].debt > profile.totalMarketable);
});

test("bond price: par at its own yield, falls when yields rise", async () => {
  const { bondPrice, priceIndex } = await import("./bonds.ts");
  assert.ok(Math.abs(bondPrice(4.5, 4.5, 10) - 100) < 1e-9);
  // A 10Y par bond loses roughly duration (~8) × 1% ≈ 7.7% for +100bp.
  const p = bondPrice(4.5, 5.5, 10);
  assert.ok(p > 91 && p < 93, String(p));
  const idx = priceIndex([{ date: "a", value: 4 }, { date: "b", value: 5 }, { date: "c", value: 4 }], 30);
  assert.ok(idx[1].value < 100 && idx[2].value > idx[1].value);
});

test("Treasury yield curve CSV fills days FRED hasn't published yet", async () => {
  const { parseYieldCurveCsv, mergeNewer } = await import("./treasury.ts");
  const csv = 'Date,"3 Mo","2 Yr","10 Yr","30 Yr"\n10/06/2026,4.21,4.79,5.27,5.64\n10/05/2026,4.22,4.84,5.31,5.66\n';
  const curve = parseYieldCurveCsv(csv);
  assert.deepEqual(curve.DGS10, [{ date: "2026-10-05", value: 5.31 }, { date: "2026-10-06", value: 5.27 }]);
  const fred = { DGS10: [{ date: "2026-10-02", value: 5.28 }, { date: "2026-10-05", value: 5.31 }], VIXCLS: [] };
  const merged = mergeNewer(fred, curve);
  assert.deepEqual(merged.DGS10.map((o) => o.date), ["2026-10-02", "2026-10-05", "2026-10-06"]);
  assert.equal(merged.DGS30, undefined); // only series we asked FRED for are topped up
});

test("correlation: perfect, inverse, and NaN-tolerant", async () => {
  const { correlation } = await import("./stats.ts");
  const a = Array.from({ length: 50 }, (_, i) => i);
  assert.ok(Math.abs(correlation(a, a.map((x) => 2 * x + 1)) - 1) < 1e-9);
  assert.ok(Math.abs(correlation(a, a.map((x) => 100 - x)) + 1) < 1e-9);
  const b = a.map((x, i) => (i % 5 === 0 ? NaN : x));
  assert.ok(Math.abs(correlation(a, b) - 1) < 1e-9);
  assert.ok(Number.isNaN(correlation(a.slice(0, 10), a.slice(0, 10))));
});

test("market-top inputs: Shiller dates and multpl tables parse correctly", async () => {
  const { parseMultplTable, phaseOf } = await import("./tops.ts");
  const html = '<tr><td class="left">Oct 6, 2026</td><td class="right">&#x2002;41.90</td></tr>' +
    '<tr><td>Oct 1, 2026</td><td>41.00</td></tr><tr><td>Sep 1, 2026</td><td>\n7,691.10</td></tr>';
  const m = parseMultplTable(html);
  assert.equal(m.get("2026-10"), 41.9);
  assert.equal(m.get("2026-09"), 7691.1);
  assert.equal(phaseOf(100, 0), "expensive");
  assert.equal(phaseOf(100, 50), "breakdown");
  assert.equal(phaseOf(25, 50), "normal");
  assert.equal(phaseOf(25, 83), "cracking");
  assert.equal(phaseOf(25, 0), "normal");
  assert.equal(phaseOf(NaN, 0), null);
});
