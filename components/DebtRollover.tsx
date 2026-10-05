"use client";

import { useMemo, useState } from "react";
import LineChart from "@/components/LineChart";
import { dateLabel, fmt, money } from "@/lib/format";
import { currentInterest, DEFAULT_MIX, ISSUANCE_TENORS, project, SCENARIOS, type Curve, type Scenario } from "@/lib/rollover";
import type { MaturityProfile } from "@/lib/treasury";

const COLORS: Record<string, string> = {
  frozen: "var(--s1)",
  crisis: "var(--s2)",
  cuts: "var(--s3)",
  parallel: "var(--s4)",
  steepener: "var(--s5)",
  stagflation: "var(--s6)",
  custom: "var(--s7)",
};

const METRICS = [
  { id: "interest", label: "Interest $", format: "money" as const, pick: (r: { interest: number }) => r.interest },
  { id: "interestToGdp", label: "Interest % GDP", format: "pct" as const, pick: (r: { interestToGdp: number }) => r.interestToGdp },
  { id: "debtToGdp", label: "Debt % GDP", format: "pct" as const, pick: (r: { debtToGdp: number }) => r.debtToGdp },
  { id: "avgRate", label: "Avg rate", format: "pct" as const, pick: (r: { avgRate: number }) => r.avgRate },
];

function MaturityWall({ profile }: { profile: MaturityProfile }) {
  const year0 = Number(profile.recordDate.slice(0, 4));
  const rows = profile.buckets.filter((b) => b.yearIndex < 10);
  const beyond = profile.buckets.filter((b) => b.yearIndex >= 10).reduce((s, b) => s + b.amount, 0);
  const bars = [...rows.map((b) => ({ label: `${b.yearIndex === 0 ? "<1y" : `${b.yearIndex}–${b.yearIndex + 1}y`}`, amount: b.amount, rate: b.rate, bill: b.billShare })), { label: "10y+", amount: beyond, rate: NaN, bill: 0 }];
  const max = Math.max(...bars.map((b) => b.amount));
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 150 }} role="img" aria-label="Marketable debt maturing per year">
        {bars.map((b, i) => (
          <div
            key={b.label}
            onPointerEnter={() => setHover(i)}
            onPointerLeave={() => setHover(null)}
            style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%", cursor: "default" }}
          >
            <div className="small num" style={{ textAlign: "center", color: "var(--ink-2)", fontSize: 11, visibility: i === 0 || hover === i ? "visible" : "hidden" }}>
              {money(b.amount, 1)}
            </div>
            <div style={{ height: `${(b.amount / max) * 120}px`, background: hover === i ? "var(--s1)" : "color-mix(in srgb, var(--s1) 75%, var(--surface))", borderRadius: "4px 4px 0 0" }} />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
        {bars.map((b) => <div key={b.label} className="muted" style={{ flex: 1, textAlign: "center", fontSize: 11 }}>{b.label}</div>)}
      </div>
      <p className="small muted" style={{ marginTop: 8, minHeight: 20 }}>
        {hover != null && bars[hover]
          ? `${bars[hover].label}: ${money(bars[hover].amount, 2)} maturing${Number.isFinite(bars[hover].rate) ? `, avg coupon ${fmt(bars[hover].rate, 2)}%` : ""}${bars[hover].bill ? `, ${Math.round(bars[hover].bill * 100)}% bills/FRNs` : ""}.`
          : `Hover a bar for detail. Year buckets start from ${dateLabel(profile.recordDate)} (${year0}).`}
      </p>
    </div>
  );
}

export default function DebtRollover({ profile, curve, gdp }: { profile: MaturityProfile; curve: Curve; gdp: { date: string; value: number } }) {
  const [selected, setSelected] = useState<string[]>(["frozen", "cuts", "steepener", "crisis"]);
  const [metric, setMetric] = useState("interest");
  const [custom, setCustom] = useState<Scenario>({
    id: "custom", name: "Custom", description: "Your own shock.", shiftBp: [50, 100, 150, 150], rampYears: 2, primaryDeficitPct: 3.5, nominalGrowthPct: 4,
  });
  const [mix, setMix] = useState<number[]>(DEFAULT_MIX);

  const all = [...SCENARIOS, custom];
  const results = useMemo(
    () => Object.fromEntries([...SCENARIOS, custom].map((s) => [s.id, project({ profile, curve, scenario: s, gdp: gdp.value, mix })])),
    [profile, curve, gdp.value, custom, mix],
  );

  const now = currentInterest(profile);
  const in12m = profile.buckets.find((b) => b.yearIndex === 0)?.amount ?? 0;
  const year0 = Number(profile.recordDate.slice(0, 4));
  const m = METRICS.find((x) => x.id === metric)!;
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const setShift = (i: number, v: number) => setCustom((c) => {
    const shiftBp = [...c.shiftBp] as Scenario["shiftBp"];
    shiftBp[i] = v;
    return { ...c, shiftBp };
  });

  return (
    <div>
      <div className="card">
        <div className="stats">
          <div className="stat"><div className="v num">{money(profile.totalMarketable)}</div><div className="l">Marketable debt</div></div>
          <div className="stat"><div className="v num">{money(now)}</div><div className="l">Annual interest at today's coupons</div></div>
          <div className="stat"><div className="v num">{fmt((100 * now) / profile.totalMarketable, 2)}%</div><div className="l">Average rate paid</div></div>
          <div className="stat"><div className="v num">{money(in12m)}</div><div className="l">Maturing in 12 months ({Math.round((100 * in12m) / profile.totalMarketable)}%)</div></div>
          <div className="stat"><div className="v num">{fmt(profile.weightedAvgMaturityYears, 1)} yrs</div><div className="l">Weighted avg maturity</div></div>
          <div className="stat"><div className="v num">{fmt(curve.y10, 2)}%</div><div className="l">10Y today vs {fmt((100 * now) / profile.totalMarketable, 2)}% paid</div></div>
        </div>
      </div>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <div className="card">
          <h3>Maturity wall</h3>
          <p className="small muted" style={{ margin: "2px 0 10px" }}>Marketable Treasury debt by years to maturity (MSPD, {dateLabel(profile.recordDate)}). Everything here gets refinanced at whatever rates prevail.</p>
          <MaturityWall profile={profile} />
        </div>
        <div className="card">
          <h3>Custom scenario</h3>
          <p className="small muted" style={{ margin: "2px 0 10px" }}>Shifts versus today's curve (bp), reached over the ramp period.</p>
          <div className="row">
            {(["3M", "2Y", "10Y", "30Y"] as const).map((lbl, i) => (
              <label key={lbl} className="field">{lbl} shift
                <input type="number" step={25} value={custom.shiftBp[i]} onChange={(e) => setShift(i, Number(e.target.value))} />
              </label>
            ))}
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <label className="field">Ramp (yrs)<input type="number" min={1} max={10} value={custom.rampYears} onChange={(e) => setCustom({ ...custom, rampYears: Math.max(1, Number(e.target.value)) })} /></label>
            <label className="field">Primary deficit % GDP<input type="number" step={0.5} value={custom.primaryDeficitPct} onChange={(e) => setCustom({ ...custom, primaryDeficitPct: Number(e.target.value) })} /></label>
            <label className="field">Nominal growth %<input type="number" step={0.5} value={custom.nominalGrowthPct} onChange={(e) => setCustom({ ...custom, nominalGrowthPct: Number(e.target.value) })} /></label>
          </div>
          <details className="why" style={{ marginTop: 12 }}>
            <summary>Issuance mix for new borrowing</summary>
            <div className="row" style={{ marginTop: 8 }}>
              {ISSUANCE_TENORS.map((t, i) => (
                <label key={t} className="field">{t === 1 ? "Bills" : `${t}Y`} %
                  <input type="number" min={0} max={100} step={5} value={Math.round(mix[i] * 100)} onChange={(e) => setMix((mx) => mx.map((v, j) => (j === i ? Number(e.target.value) / 100 : v)))} />
                </label>
              ))}
            </div>
            <p className="small muted" style={{ marginTop: 6 }}>More bills = cheaper today if the curve is upward sloping, but more of the debt reprices every year.</p>
          </details>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
          <div className="row" style={{ gap: 6 }} role="group" aria-label="Scenarios">
            {all.map((s) => (
              <button key={s.id} className="chip" aria-pressed={selected.includes(s.id)} onClick={() => toggle(s.id)} title={s.description}>
                <span className="swatch" style={{ background: COLORS[s.id] }} />{s.name}
              </button>
            ))}
          </div>
          <div className="seg" role="group" aria-label="Metric">
            {METRICS.map((x) => <button key={x.id} aria-pressed={metric === x.id} onClick={() => setMetric(x.id)}>{x.label}</button>)}
          </div>
        </div>
        <LineChart
          ariaLabel={`${m.label} by scenario`}
          x={Array.from({ length: 10 }, (_, i) => `FY${year0 + i + 1}`)}
          xIsDate={false}
          series={all.filter((s) => selected.includes(s.id)).map((s) => ({ id: s.id, name: s.name, color: COLORS[s.id], values: results[s.id].map((r) => m.pick(r)) }))}
          format={m.format}
          height={300}
        />
      </div>

      <div className="card table-wrap" style={{ marginTop: 16 }}>
        <table className="data">
          <thead>
            <tr>
              <th>Scenario</th>
              <th className="r">Interest yr 1</th>
              <th className="r">Interest yr 5</th>
              <th className="r">Interest yr 10</th>
              <th className="r">10-yr total</th>
              <th className="r">Interest % GDP yr 10</th>
              <th className="r">Debt % GDP yr 10</th>
            </tr>
          </thead>
          <tbody>
            {all.map((s) => {
              const r = results[s.id];
              const total = r.reduce((a, x) => a + x.interest, 0);
              return (
                <tr key={s.id}>
                  <td><span className="row" style={{ gap: 6, display: "inline-flex", alignItems: "center" }}><span className="swatch" style={{ background: COLORS[s.id] }} />{s.name}</span><div className="small muted" style={{ whiteSpace: "normal", maxWidth: 360 }}>{s.description}</div></td>
                  <td className="r">{money(r[0].interest)}</td>
                  <td className="r">{money(r[4].interest)}</td>
                  <td className="r">{money(r[9].interest)}</td>
                  <td className="r">{money(total)}</td>
                  <td className="r">{fmt(r[9].interestToGdp, 1)}%</td>
                  <td className="r">{fmt(r[9].debtToGdp, 0)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="small muted" style={{ marginTop: 10 }}>
          Starting GDP {money(gdp.value)} (FRED, {dateLabel(gdp.date)}, annualized). Marketable debt only; excludes intragovernmental debt, TIPS inflation accrual and Fed remittances.
          A range across scenarios is the point, not any single line.
        </p>
      </div>
    </div>
  );
}
