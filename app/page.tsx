import ActivePlaybook from "@/components/ActivePlaybook";
import BondChart from "@/components/BondChart";
import TvChart from "@/components/TvChart";
import RegimeHistoryChart from "@/components/RegimeHistoryChart";
import Sparkline from "@/components/Sparkline";
import { getAuctionData, getHistoryCharts, getMarket } from "@/lib/data";
import { dateLabel, fmt, money, REGIME_COLORS, signed, STATUS_ICON } from "@/lib/format";
import { LEVELS, type RegimeResult } from "@/lib/regimes";

export const revalidate = 21600;

function StatusBadge({ status, label }: { status: string; label: string }) {
  return (
    <span className="badge">
      <span aria-hidden="true" style={{ color: `var(--${status})` }}>{STATUS_ICON[status]}</span>
      {label}
    </span>
  );
}

function RegimeCard({ r }: { r: RegimeResult }) {
  const color = REGIME_COLORS[r.id];
  const maxAbs = Math.max(0.5, ...r.contributions.map((c) => Math.abs(c.contribution)).filter(Number.isFinite));
  return (
    <div className="card regime">
      <div className="regime-top">
        <div className="regime-name">
          <span className="swatch" style={{ background: color }} />
          <h3>{r.name}</h3>
        </div>
        <StatusBadge status={r.level.status} label={r.level.label} />
      </div>
      <div className="score-row">
        <span className="score num">{Number.isFinite(r.score) ? Math.round(r.score) : "–"}</span>
        <span className="small ink2">/ 100 · {signed(r.change20d, 0)} in 1 month</span>
      </div>
      <div className="bar" aria-hidden="true">
        <span style={{ width: `${Math.max(0, Math.min(100, r.score))}%`, background: color }} />
        {LEVELS.filter((l) => l.min > 0).map((l) => <span key={l.key} className="tick" style={{ left: `${l.min}%` }} />)}
      </div>
      <p className="small ink2">{r.tagline}</p>
      <details className="why">
        <summary>Why this score</summary>
        <p className="small ink2" style={{ marginTop: 6 }}>{r.description}</p>
        <table className="contrib">
          <tbody>
            {r.contributions.map((c) => (
              <tr key={c.feature}>
                <td>
                  {c.label}
                  <div className="muted num">{fmt(c.raw, c.unit === "%" ? 1 : 0)}{c.unit && c.unit !== "%" ? ` ${c.unit}` : c.unit} · z {fmt(c.z, 1)}{c.weight < 0 ? " (inverted)" : ""}</div>
                </td>
                <td>
                  <div className="cbar" title={`contribution ${fmt(c.contribution, 2)}`}>
                    {Number.isFinite(c.contribution) && (
                      <span
                        style={{
                          left: c.contribution >= 0 ? "50%" : `${50 - (50 * Math.abs(c.contribution)) / maxAbs}%`,
                          width: `${(50 * Math.abs(c.contribution)) / maxAbs}%`,
                          background: c.contribution >= 0 ? "var(--critical)" : "var(--good)",
                        }}
                      />
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small muted" style={{ marginTop: 6 }}>
          Red pushes stress up, green pulls it down. Alert (≥95) on {fmt(r.alertRate * 100, 1)}% of days since 2006.
        </p>
      </details>
    </div>
  );
}

export default async function Dashboard() {
  const [market, auctions] = await Promise.all([getMarket(), getAuctionData()]);
  const history = await getHistoryCharts(market.data);
  const lastOf = (a: number[]) => { for (let i = a.length - 1; i >= 0; i--) if (Number.isFinite(a[i])) return { v: a[i], i }; return { v: NaN, i: -1 }; };
  const yearAgo = (dates: string[], values: number[]) => {
    const { i } = lastOf(values);
    if (i < 0) return NaN;
    const target = new Date(Date.parse(dates[i]) - 365 * 86400000).toISOString().slice(0, 10);
    const j = dates.findIndex((d) => d >= target);
    return j >= 0 ? values[j] : NaN;
  };
  const { regimes, indicators } = market;
  const top = [...regimes.regimes].sort((a, b) => b.score - a.score)[0];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Bond-market stress today</h1>
          <p>
            Four regime scores built from daily market data, scaled 0–100 against their own history since 2006
            (50 = a normal day, 85 ≈ 1 in 7 days, 95 ≈ 1 in 20).
            {top && Number.isFinite(top.score) ? <> Highest right now: <strong>{top.name}</strong> at {Math.round(top.score)}.</> : null}
          </p>
        </div>
        <span className="small muted">Data as of {dateLabel(regimes.asOf)}</span>
      </div>

      {market.missing.length > 0 && (
        <div className="alert warning" style={{ marginBottom: 12 }}>
          <span className="icon" aria-hidden="true">▲</span>
          <div className="small">Some series failed to load and are left out of the scores: {market.missing.join(", ")}. Setting FRED_API_KEY makes loading more reliable.</div>
        </div>
      )}

      <div className="grid grid-4">
        {regimes.regimes.map((r) => <RegimeCard key={r.id} r={r} />)}
      </div>

      <div className="section">
        <ActivePlaybook regimes={regimes.regimes.map((r) => ({ id: r.id, name: r.name, score: r.score, status: r.level.status }))} />
      </div>

      <div className="section card">
        <div className="section-head" style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
          <h2>Regime history</h2>
          <span className="small muted">Weekly samples · hover for values · dashed lines at 85 and 95</span>
        </div>
        <RegimeHistoryChart
          dates={regimes.history.dates}
          series={regimes.regimes.map((r) => ({ id: r.id, name: r.name, color: REGIME_COLORS[r.id], values: regimes.history.scores[r.id] }))}
          events={regimes.events.map((e) => ({ date: e.date, label: e.label }))}
          height={600}
        />
      </div>

      <div className="section card">
        <div className="section-head" style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
          <h2>Treasury bond prices</h2>
          {(() => {
            const t = history.bonds.tenors.find((x) => x.id === "30y");
            if (!t) return null;
            const now = lastOf(t.prices).v, ago = yearAgo(history.bonds.dates, t.prices);
            return Number.isFinite(now) && Number.isFinite(ago)
              ? <span className="small ink2">30-year price {signed((100 * (now - ago)) / ago, 1)}% over 12 months</span>
              : null;
          })()}
        </div>
        <BondChart dates={history.bonds.dates} tenors={history.bonds.tenors} />
      </div>

      <div className="section card">
        <div className="section-head" style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
          <h2>Federal debt</h2>
          {history.debt && (() => {
            const now = lastOf(history.debt.total).v, ago = yearAgo(history.debt.dates, history.debt.total);
            return <span className="small ink2">${fmt(now, 2)}T total · {Number.isFinite(ago) ? `${now >= ago ? "+" : "−"}${money(Math.abs(now - ago) * 1e12)} over 12 months` : ""}</span>;
          })()}
        </div>
        {history.debt ? (
          <TvChart
            dates={history.debt.dates}
            series={[
              { id: "total", name: "Total public debt", color: "var(--s1)", values: history.debt.total },
              { id: "public", name: "Held by the public", color: "var(--s2)", values: history.debt.public },
            ]}
            persistKey="debt-chart"
            ariaLabel="Federal debt outstanding"
            format="trillions"
            defaultRange="All"
            height={380}
            help="Daily, from Treasury's Debt to the Penny. Total includes debt held by trust funds (Social Security etc.); held by the public is what trades in the market."
          />
        ) : <p className="small muted">Debt data unavailable right now.</p>}
      </div>

      <div className="section card">
        <div className="section-head" style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
          <h2>Interest payments</h2>
          {history.interest && (() => {
            const now = lastOf(history.interest.public12m).v, ago = yearAgo(history.interest.dates, history.interest.public12m);
            return <span className="small ink2">${fmt(now * 1000, 0)}B on public debt over the last 12 months · {Number.isFinite(ago) ? `${signed((100 * (now - ago)) / ago, 0)}% vs a year earlier` : ""}</span>;
          })()}
        </div>
        {history.interest ? (
          <TvChart
            dates={history.interest.dates}
            series={[
              { id: "public", name: "Interest on public debt", color: "var(--s1)", values: history.interest.public12m },
              { id: "total", name: "Incl. trust-fund interest", color: "var(--s2)", values: history.interest.total12m },
            ]}
            persistKey="interest-chart"
            ariaLabel="Federal interest expense, trailing 12 months"
            format="trillions"
            defaultRange="All"
            height={380}
            help="Trailing 12-month totals of monthly interest expense (Treasury FiscalData), so seasonality doesn't hide the trend. Interest to trust funds is paid to the government itself."
          />
        ) : <p className="small muted">Interest data unavailable right now.</p>}
      </div>

      <div className="section">
        <div className="section-head">
          <h2>Calibration check</h2>
          <span className="small muted">Peak score within ±2 weeks of each event. A good model lights up the expected regime and stays quiet otherwise.</span>
        </div>
        <div className="card table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Event</th>
                <th>Date</th>
                <th>Expected</th>
                {regimes.regimes.map((r) => <th key={r.id} className="r">{r.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {regimes.events.map((e) => (
                <tr key={e.date}>
                  <td>{e.label}</td>
                  <td className="muted">{dateLabel(e.date)}</td>
                  <td>{regimes.regimes.find((r) => r.id === e.expect)?.name}</td>
                  {regimes.regimes.map((r) => {
                    const v = e.peaks[r.id];
                    const hit = r.id === e.expect;
                    return (
                      <td key={r.id} className="r" style={{ fontWeight: hit ? 650 : 400, color: hit ? "var(--ink)" : "var(--ink-2)" }}>
                        {Number.isFinite(v) ? Math.round(v) : "–"}{hit && v >= 85 ? " ✓" : ""}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <h2>Risk indicators</h2>
          <span className="small muted">1-year sparkline · 1-month change · z = how unusual that change is vs the last 3 years (signed so + = more risk)</span>
        </div>
        <div className="grid grid-4">
          {indicators.map((t) => {
            const risky = t.riskZ >= 1.5;
            return (
              <div key={t.id} className="card tile" title={t.why}>
                <div className="tile-head">
                  <span className="small ink2">{t.label}</span>
                  {risky && <StatusBadge status={t.riskZ >= 2.5 ? "critical" : "serious"} label={`z ${fmt(t.riskZ, 1)}`} />}
                </div>
                <div className="tile-value num">
                  {t.unit === "$bn" ? money(t.value * 1e9, 0) : `${fmt(t.value, t.decimals)}${t.unit === "%" ? "%" : t.unit === "bp" ? " bp" : ""}`}
                </div>
                <Sparkline values={t.spark} color={risky ? "var(--critical)" : "var(--ink-2)"} />
                <div className="tile-foot">
                  <span className="num">{signed(t.change20d, t.changeUnit === "bp" || t.changeUnit === "$bn" ? 0 : 1)} {t.changeUnit} 1m</span>
                  <span className="num muted">z {fmt(t.riskZ, 1)}</span>
                </div>
                <p className="small muted">{t.why}</p>
              </div>
            );
          })}
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <h2>Treasury auctions</h2>
          <span className="small muted">
            {auctions ? <>Last {auctions.recentCount} coupon auctions: {auctions.weakCount} weak, {auctions.strongCount} strong vs their recent average</> : "Auction data unavailable"}
          </span>
        </div>
        {auctions && (
          <div className="grid grid-split">
            <div className="card table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Security</th>
                    <th className="r">Size</th>
                    <th className="r">High yield</th>
                    <th className="r" title="Auction high yield minus that day's constant-maturity close. Noisy proxy for the tail (true tails need when-issued yields).">vs close</th>
                    <th className="r">Bid/cover</th>
                    <th className="r">vs avg</th>
                    <th className="r">Indirect</th>
                    <th className="r">vs avg</th>
                    <th>Read</th>
                  </tr>
                </thead>
                <tbody>
                  {auctions.rows.slice(0, 14).map((a) => (
                    <tr key={a.date + a.term}>
                      <td className="muted">{dateLabel(a.date)}</td>
                      <td>{a.term}{a.reopening ? <span className="muted"> (reopen)</span> : null}</td>
                      <td className="r">{money(a.offering, 0)}</td>
                      <td className="r">{fmt(a.highYield, 3)}%</td>
                      <td className="r">{a.vsCloseBp == null ? "–" : `${signed(a.vsCloseBp, 1)} bp`}</td>
                      <td className="r">{fmt(a.bidToCover, 2)}</td>
                      <td className="r">{signed(a.btcVsAvg, 2)}</td>
                      <td className="r">{fmt(a.indirectShare, 1)}%</td>
                      <td className="r">{a.indirectVsAvg == null ? "–" : `${signed(a.indirectVsAvg, 1)} pt`}</td>
                      <td>{a.weak ? <StatusBadge status="serious" label="Weak" /> : a.strong ? <StatusBadge status="good" label="Strong" /> : <span className="muted small">Normal</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card">
              <h3>Upcoming</h3>
              {auctions.upcoming.length === 0 && <p className="small muted" style={{ marginTop: 6 }}>No announced coupon auctions.</p>}
              <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0" }}>
                {auctions.upcoming.slice(0, 10).map((a) => (
                  <li key={a.date + a.term} style={{ padding: "6px 0", borderBottom: "1px solid var(--grid)" }}>
                    <div><strong>{a.term}</strong>{a.reopening ? <span className="muted small"> reopen</span> : null}</div>
                    <div className="small muted">{dateLabel(a.date)} · {money(a.offering, 0)}</div>
                  </li>
                ))}
              </ul>
              <p className="small muted" style={{ marginTop: 8 }}>10Y, 20Y and 30Y auctions are the ones to watch for fiscal stress.</p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
