"use client";

import { useMemo } from "react";
import { fmt, money, signed } from "@/lib/format";
import { usePersisted } from "@/lib/usePersisted";
import { addDays, legValue, portfolioValue, SPX_MULTIPLIER, stressGrid, type MarketState, type OptionLeg } from "@/lib/options";

const MOVES = [-30, -20, -15, -10, -5, 0, 5, 10];
const VOL_MULTS = [0.8, 1, 1.5, 2, 3];

/** Shocks tied to the regimes on the dashboard. */
const PRESETS = [
  { id: "liquidity", name: "Liquidity crisis", note: "March 2020-style dash for cash", move: -25, vol: 3, days: 20 },
  { id: "fiscal", name: "Fiscal stress", note: "April 2025-style ‘sell America’", move: -12, vol: 2, days: 5 },
  { id: "growth", name: "Growth scare", note: "Aug 2024 / 2011-style risk-off", move: -10, vol: 1.8, days: 15 },
  { id: "inflation", name: "Inflation grind", note: "2022-style slow bleed", move: -8, vol: 1.3, days: 60 },
  { id: "calm", name: "Grind higher", note: "Hedges decay", move: 6, vol: 0.85, days: 30 },
];

const round25 = (v: number) => Math.round(v / 25) * 25;

function defaultLegs(spot: number, today: string): OptionLeg[] {
  const expiry = addDays(today, 90);
  return [
    { id: "a", kind: "put", strike: round25(spot * 0.95), expiry, qty: 1 },
    { id: "b", kind: "put", strike: round25(spot * 0.85), expiry, qty: -1 },
  ];
}

function cellColor(v: number, max: number) {
  if (!Number.isFinite(v) || max <= 0) return "transparent";
  const pct = Math.round(Math.min(1, Math.abs(v) / max) * 70);
  return `color-mix(in srgb, ${v >= 0 ? "var(--div-pos)" : "var(--div-neg)"} ${pct}%, var(--div-mid))`;
}

export default function PortfolioStress({ spot: spot0, vix, shortRate, today }: { spot: number; vix: number; shortRate: number; today: string }) {
  // Live inputs from FRED; anything you type over is remembered as an override.
  const live = { spot: Math.round(spot0), atmVol: vix / 100, rate: shortRate / 100, divYield: 0.013, skew: 3 };
  type Inputs = typeof live;
  const [overrides, setOverrides] = usePersisted<Partial<Inputs>>("hedge:market", {});
  const market: MarketState = { ...live, ...overrides, asOf: today };
  const setField = (k: keyof Inputs, v: number) => setOverrides((o) => ({ ...o, [k]: v }));
  const [legs, setLegs] = usePersisted<OptionLeg[]>("legs:v1", defaultLegs(spot0, today));
  const [days, setDays] = usePersisted("hedge:days", 7);

  const value = portfolioValue(legs, market);
  const grid = useMemo(() => stressGrid(legs, market, MOVES, VOL_MULTS, days), [legs, market, days]);
  const max = Math.max(...grid.flat().map(Math.abs).filter(Number.isFinite));
  const presets = PRESETS.map((p) => {
    const shocked = { ...market, asOf: addDays(market.asOf, p.days), spot: market.spot * (1 + p.move / 100), atmVol: market.atmVol * p.vol };
    return { ...p, pnl: portfolioValue(legs, shocked) - value };
  });

  // Max payoff of the structure at expiry (for put spreads: width × qty).
  const expiryValues = [0.5, 0.7, 0.8, 0.9, 1, 1.1].map((k) => portfolioValue(legs, { ...market, spot: market.spot * k, asOf: "2999-01-01" }));
  const maxPayoff = Math.max(...expiryValues);

  const update = (id: string, patch: Partial<OptionLeg>) => setLegs((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const num = (v: string) => (v === "" ? 0 : Number(v));

  return (
    <div>
      <div className="grid grid-2">
        <div className="card">
          <h3>Market inputs</h3>
          <p className="small muted" style={{ margin: "2px 0 10px" }}>
            Pre-filled from FRED (S&amp;P 500, VIX, 3M bill). Values you type are remembered.
            {Object.keys(overrides).length > 0 && (
              <> <button className="btn ghost" style={{ padding: "0 4px" }} onClick={() => setOverrides({})}>Use live data</button></>
            )}
          </p>
          <div className="row">
            <label className="field">SPX<input type="number" value={market.spot} onChange={(e) => setField("spot", num(e.target.value))} /></label>
            <label className="field">ATM vol %<input type="number" step={0.5} value={Math.round(market.atmVol * 1000) / 10} onChange={(e) => setField("atmVol", num(e.target.value) / 100)} /></label>
            <label className="field">Rate %<input type="number" step={0.1} value={Math.round(market.rate * 1000) / 10} onChange={(e) => setField("rate", num(e.target.value) / 100)} /></label>
            <label className="field">Div yield %<input type="number" step={0.1} value={Math.round(market.divYield * 1000) / 10} onChange={(e) => setField("divYield", num(e.target.value) / 100)} /></label>
            <label className="field" title="How much more vol OTM puts carry: vol(K) = ATM × (1 + skew × ln(S/K)). 3 ≈ typical SPX.">Skew<input type="number" step={0.5} value={market.skew} onChange={(e) => setField("skew", num(e.target.value))} /></label>
          </div>
        </div>
        <div className="card">
          <h3>Position now</h3>
          <div className="stats" style={{ marginTop: 8 }}>
            <div className="stat"><div className="v num">{money(value, 0)}</div><div className="l">Model value</div></div>
            <div className="stat"><div className="v num">{money(maxPayoff, 0)}</div><div className="l">Max value at expiry</div></div>
            <div className="stat"><div className="v num">{value > 0 ? `${fmt(maxPayoff / value, 1)}×` : "–"}</div><div className="l">Payoff / cost</div></div>
          </div>
          <p className="small muted" style={{ marginTop: 10 }}>Black–Scholes with a simple skew. Good for sizing and comparing scenarios; not a substitute for your broker's marks.</p>
        </div>
      </div>

      <div className="card table-wrap" style={{ marginTop: 16 }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
          <h3>Legs</h3>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn" onClick={() => setLegs((ls) => [...ls, { id: Math.random().toString(36).slice(2, 8), kind: "put", strike: round25(market.spot * 0.9), expiry: addDays(today, 90), qty: 1 }])}>Add leg</button>
            <button className="btn ghost" onClick={() => setLegs(defaultLegs(market.spot, today))}>Reset to sample spread</button>
          </div>
        </div>
        <table className="data">
          <thead>
            <tr><th>Type</th><th>Strike</th><th>Expiry</th><th>Qty (+long / −short)</th><th className="r">Moneyness</th><th className="r">Model price</th><th className="r">Leg value</th><th /></tr>
          </thead>
          <tbody>
            {legs.map((l) => {
              const px = legValue(l, market);
              return (
                <tr key={l.id}>
                  <td>
                    <select value={l.kind} onChange={(e) => update(l.id, { kind: e.target.value as OptionLeg["kind"] })}>
                      <option value="put">Put</option>
                      <option value="call">Call</option>
                    </select>
                  </td>
                  <td><input type="number" step={25} value={l.strike} onChange={(e) => update(l.id, { strike: num(e.target.value) })} /></td>
                  <td><input type="date" value={l.expiry} onChange={(e) => update(l.id, { expiry: e.target.value })} /></td>
                  <td><input type="number" value={l.qty} onChange={(e) => update(l.id, { qty: num(e.target.value) })} /></td>
                  <td className="r">{fmt((100 * l.strike) / market.spot, 1)}%</td>
                  <td className="r">{fmt(px, 2)}</td>
                  <td className="r">{money(l.qty * SPX_MULTIPLIER * px, 0)}</td>
                  <td><button className="btn ghost" aria-label="Remove leg" onClick={() => setLegs((ls) => ls.filter((x) => x.id !== l.id))}>✕</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="section">
        <div className="section-head">
          <h2>Regime shocks</h2>
          <span className="small muted">P&amp;L vs today for shocks shaped like each regime</span>
        </div>
        <div className="card table-wrap">
          <table className="data">
            <thead><tr><th>Shock</th><th className="r">SPX</th><th className="r">Vol</th><th className="r">Days</th><th className="r">P&amp;L</th><th className="r">% of max</th></tr></thead>
            <tbody>
              {presets.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}<div className="small muted">{p.note}</div></td>
                  <td className="r">{signed(p.move, 0)}%</td>
                  <td className="r">×{p.vol}</td>
                  <td className="r">{p.days}</td>
                  <td className="r" style={{ fontWeight: 650, color: p.pnl >= 0 ? "var(--good-ink)" : "var(--critical-ink)" }}>{p.pnl >= 0 ? "+" : ""}{money(p.pnl, 0)}</td>
                  <td className="r">{maxPayoff > 0 ? `${Math.round((100 * (p.pnl + value)) / maxPayoff)}%` : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <h2>Stress grid</h2>
          <label className="small ink2 row" style={{ gap: 6, alignItems: "center" }}>
            Horizon (days)
            <input type="number" min={0} max={365} value={days} onChange={(e) => setDays(Math.max(0, num(e.target.value)))} style={{ width: 70 }} />
          </label>
        </div>
        <div className="card table-wrap">
          <table className="data heat">
            <thead>
              <tr>
                <th>SPX move ↓ / vol ×</th>
                {VOL_MULTS.map((v) => <th key={v} className="r">×{v} ({fmt(market.atmVol * v * 100, 0)})</th>)}
              </tr>
            </thead>
            <tbody>
              {MOVES.map((mv, i) => (
                <tr key={mv}>
                  <td><strong>{signed(mv, 0)}%</strong> <span className="muted small">{fmt(market.spot * (1 + mv / 100), 0)}</span></td>
                  {grid[i].map((v, j) => (
                    <td key={j} className="cell" style={{ background: cellColor(v, max) }}>
                      {v >= 0 ? "+" : ""}{money(v, 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small muted" style={{ marginTop: 8 }}>Blue = gain, red = loss vs today's model value, after {days} days of time decay. Positions are saved in this browser only.</p>
        </div>
      </div>
    </div>
  );
}
