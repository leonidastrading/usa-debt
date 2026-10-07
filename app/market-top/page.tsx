import TvChart, { type TvFormat, type TvSeries } from "@/components/TvChart";
import { dateLabel, fmt, STATUS_ICON } from "@/lib/format";
import { computeTops, GROUPS, loadTopsInputs, PHASES, SIGNALS, type PhaseKey } from "@/lib/tops";

export const revalidate = 21600;
export const metadata = { title: "Market top · Treasury Risk Monitor" };

const LEVEL = [
  { label: "Normal", status: "good" },
  { label: "Elevated", status: "warning" },
  { label: "Flashing", status: "critical" },
] as const;

function Light({ level }: { level: 0 | 1 | 2 }) {
  const l = LEVEL[level];
  return (
    <span className="badge">
      <span aria-hidden="true" style={{ color: `var(--${l.status})` }}>{STATUS_ICON[l.status]}</span>
      {l.label}
    </span>
  );
}

const monthLabel = (m: string) => dateLabel(`${m}-01`).replace(/ 1,/, "");
const pct = (v: number) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : "–");

/** Per-signal chart setup: which series to plot, thresholds and format. */
type ChartCfg = { format: TvFormat; refs: { price: number; title: string }[]; series: (s: Record<string, number[]>) => Omit<TvSeries, "color">[] };
const CHARTS: Record<string, ChartCfg> = {
  cape: { format: "index", refs: [{ price: 35, title: "Flashing 35" }, { price: 30, title: "Elevated 30" }], series: (s) => [{ id: "cape", name: "CAPE", values: s.cape }] },
  ecy: { format: "pct", refs: [{ price: 3, title: "Elevated < 3%" }, { price: 2, title: "Flashing < 2%" }, { price: 0, title: "0" }], series: (s) => [{ id: "ecy", name: "Excess CAPE Yield", values: s.ecy }] },
  buffett: { format: "pct0", refs: [{ price: 200, title: "Flashing 200%" }, { price: 150, title: "Elevated 150%" }], series: (s) => [{ id: "buffett", name: "Market value ÷ GDP", values: s.buffett }] },
  margin: { format: "pct0", refs: [{ price: 35, title: "Flashing 35%" }, { price: 20, title: "Elevated 20%" }, { price: 0, title: "0" }], series: (s) => [{ id: "margin", name: "Margin debt, y/y", values: s.marginYoY }] },
  curve: { format: "pct", refs: [{ price: 0, title: "Inverted below 0" }], series: (s) => [{ id: "curve", name: "10Y − 2Y", values: s.curve }] },
  fed: { format: "pct", refs: [{ price: 2, title: "Flashing +2" }, { price: 1, title: "Elevated +1" }], series: (s) => [{ id: "rise", name: "Rise from 3-year low", values: s.fedChg24 }, { id: "fed", name: "Fed funds rate", values: s.fed, lineWidth: 1 }] },
  trend: { format: "pct", refs: [{ price: 2, title: "Elevated < 2%" }, { price: 0, title: "Flashing < 0" }], series: (s) => [{ id: "gap", name: "S&P vs 10-month average", values: s.trendGap }] },
  credit: { format: "pct", refs: [{ price: 0.6, title: "Flashing +0.6" }, { price: 0.3, title: "Elevated +0.3" }], series: (s) => [{ id: "rise", name: "Rise from 12-month low", values: s.baaRise }, { id: "baa", name: "Baa spread", values: s.baa, lineWidth: 1 }] },
  sahm: { format: "pct", refs: [{ price: 0.5, title: "Flashing 0.5" }, { price: 0.3, title: "Elevated 0.3" }], series: (s) => [{ id: "sahm", name: "Sahm rule", values: s.sahm }] },
};
const PALETTE = ["var(--s1)", "var(--s2)", "var(--s3)"];

export default async function MarketTop() {
  const inputs = await loadTopsInputs();
  const t = computeTops(inputs);
  const { current, backtest } = t;
  const dates = t.months.map((m) => `${m}-01`);
  const spxOverlay: TvSeries = {
    id: "spx", name: "S&P 500", color: "var(--s5)", lineWidth: 2, lineStyle: "dashed", leftAxis: true, optional: true, format: "level", values: t.series.spx,
  };
  const phase = current.phase ? PHASES[current.phase] : null;
  const phaseRow = (k: PhaseKey) => backtest.byPhase.find((b) => b.key === k);
  const events = t.backtest.tops.map((x) => ({ date: `${x.month}-01`, label: x.label }));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Timing the market top</h1>
          <p>
            Nine warning lights in three groups, updated automatically. <strong>Fuel</strong>: how stretched valuations and leverage are.{" "}
            <strong>Pin</strong>: tightening that usually pops bubbles. <strong>Cracks</strong>: the trend, credit and jobs starting to break.
            No gauge calls the exact day; tops show up as fuel plus cracks, usually within a few months either side of the peak.
          </p>
        </div>
        <span className="small muted">Data through {monthLabel(current.month)}</span>
      </div>

      {inputs.missing.length > 0 && (
        <div className="alert warning" style={{ marginBottom: 12 }}>
          <span className="icon" aria-hidden="true">▲</span>
          <div className="small">Couldn't load: {inputs.missing.join(", ")}. Those lights are left out until the next refresh.</div>
        </div>
      )}

      {phase && (
        <div className={`alert ${phase.status === "good" ? "info" : phase.status}`} role="status">
          <span className="icon" aria-hidden="true">{STATUS_ICON[phase.status]}</span>
          <div>
            <strong style={{ fontSize: 17 }}>Now: {phase.label}</strong>
            <span className="ink2"> · warning-light score {fmt(current.score, 0)}/100</span>
            <p className="ink2" style={{ marginTop: 4 }}>{phase.text}</p>
            {(() => {
              const r = phaseRow(current.phase!);
              return r && r.months > 0 ? (
                <p className="small muted" style={{ marginTop: 6 }}>
                  Since {backtest.since.slice(0, 4)}, months in this phase were followed by a 15%+ S&amp;P fall within a year {pct(r.fell15)} of the time
                  (all months: {pct(backtest.base)}).
                </p>
              ) : null;
            })()}
          </div>
        </div>
      )}

      <div className="grid grid-3 section" style={{ marginTop: 16 }}>
        {GROUPS.map((g, gi) => {
          const v = current.groups[g.id];
          return (
            <div key={g.id} className="card">
              <div className="regime-top">
                <h3>{g.name}</h3>
                <span className="score num" style={{ fontSize: 26 }}>{fmt(v, 0)}</span>
              </div>
              <div className="bar" style={{ margin: "8px 0" }} aria-hidden="true">
                <span style={{ width: `${Math.max(0, Math.min(100, v))}%`, background: PALETTE[gi] }} />
              </div>
              <p className="small ink2">{g.desc}</p>
            </div>
          );
        })}
      </div>

      <div className="section">
        <div className="section-head"><h2>The nine lights</h2><span className="small muted">Click a row's chart below for the history</span></div>
        <div className="card table-wrap">
          <table className="data">
            <thead><tr><th>Group</th><th>Signal</th><th>Status</th><th className="r">Now</th><th>As of</th><th>Rule</th></tr></thead>
            <tbody>
              {current.signals.map((s) => (
                <tr key={s.id}>
                  <td className="muted">{GROUPS.find((g) => g.id === s.group)?.name}</td>
                  <td><a href={`#sig-${s.id}`}>{s.name}</a></td>
                  <td><Light level={s.level} /></td>
                  <td className="r">{Number.isFinite(s.value) ? `${fmt(s.value, s.decimals)} ${s.unit}` : "–"}</td>
                  <td className="muted">{monthLabel(s.asOf)}</td>
                  <td className="small ink2" style={{ whiteSpace: "normal", minWidth: 260 }}>{s.rule}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="section card">
        <div className="section-head" style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
          <h2>Warning-light score vs the S&amp;P 500</h2>
          <span className="small muted">Monthly since 1990 · arrows mark major tops</span>
        </div>
        <p className="small ink2" style={{ marginBottom: 8, maxWidth: "80ch" }}>
          Share of the nine lights that are on (flashing counts double). Switch on the S&amp;P 500 (log scale, left axis) and the three groups
          from the legend. Look for the score climbing while the index is still rising: that is the &ldquo;fuel builds, then cracks appear&rdquo; pattern.
        </p>
        <TvChart
          dates={dates}
          series={[
            { id: "score", name: "Warning-light score", color: "var(--ink)", values: t.score },
            ...GROUPS.map((g, gi) => ({ id: g.id, name: g.name, color: PALETTE[gi], lineWidth: 1 as const, optional: true, values: t.groups[g.id] })),
            spxOverlay,
          ]}
          events={events}
          persistKey="top-score-chart"
          ariaLabel="Warning-light score history"
          format="score"
          fixedRange={[0, 100]}
          leftLog
          defaultRange="All"
          height={560}
          help="Scroll to zoom, drag to pan. Your view and series choices are remembered."
        />
      </div>

      <div className="section">
        <div className="section-head"><h2>Did it work before?</h2><span className="small muted">Backtest since {backtest.since.slice(0, 4)}, monthly</span></div>
        <div className="grid grid-2">
          <div className="card table-wrap">
            <h3 style={{ marginBottom: 6 }}>Odds of a 15%+ fall within 12 months, by phase</h3>
            <table className="data">
              <thead><tr><th>Phase</th><th className="r">Months</th><th className="r">Fell 15%+</th><th className="r">Avg worst drop</th></tr></thead>
              <tbody>
                {backtest.byPhase.map((b) => (
                  <tr key={b.key}>
                    <td><Light level={b.key === "normal" ? 0 : b.key === "expensive" ? 1 : 2} /> {PHASES[b.key].label}</td>
                    <td className="r">{b.months}</td>
                    <td className="r"><strong>{pct(b.fell15)}</strong></td>
                    <td className="r">{Number.isFinite(b.avgWorst) ? `${fmt(b.avgWorst, 1)}%` : "–"}</td>
                  </tr>
                ))}
                <tr><td className="muted">All months</td><td className="r muted">{backtest.byPhase.reduce((a, b) => a + b.months, 0)}</td><td className="r muted">{pct(backtest.base)}</td><td /></tr>
              </tbody>
            </table>
            <p className="small muted" style={{ marginTop: 8 }}>
              &ldquo;Avg worst drop&rdquo; is the average lowest point of the S&amp;P over the following 12 months. Small samples: treat the numbers as rough.
            </p>
          </div>
          <div className="card table-wrap">
            <h3 style={{ marginBottom: 6 }}>Past tops: what the lights said</h3>
            <table className="data">
              <thead><tr><th>Top</th><th className="r">Fall</th><th>6 months before</th><th>At the peak</th><th>3 months after</th></tr></thead>
              <tbody>
                {backtest.tops.map((x) => (
                  <tr key={x.month}>
                    <td>{x.label} <span className="muted small">{monthLabel(x.month)}</span></td>
                    <td className="r">{x.fall}%</td>
                    {[x.before6, x.atPeak, x.after3].map((p, i) => <td key={i} className="small">{p ? PHASES[p].label : "–"}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="small muted" style={{ marginTop: 8 }}>
              Valuation-driven tops (2000, 2022) show &ldquo;expensive&rdquo; for months, then &ldquo;cracking&rdquo; soon after the peak. Shock-driven falls
              (2020) give little warning. That&rsquo;s why hedges stay on while the market is expensive, rather than waiting for a sell signal.
            </p>
          </div>
        </div>
      </div>

      <div className="section">
        <div className="section-head"><h2>Each light in detail</h2><span className="small muted">Monthly history · switch on the S&amp;P 500 in any legend</span></div>
        {SIGNALS.map((sig) => {
          const c = current.signals.find((x) => x.id === sig.id)!;
          const cfg = CHARTS[sig.id];
          const series: TvSeries[] = [...cfg.series(t.series).map((s, i) => ({ ...s, color: PALETTE[i] })), spxOverlay];
          return (
            <div key={sig.id} id={`sig-${sig.id}`} className="card" style={{ marginTop: 16, scrollMarginTop: 70 }}>
              <div className="regime-top" style={{ marginBottom: 6 }}>
                <div>
                  <span className="small muted">{GROUPS.find((g) => g.id === sig.group)?.name}</span>
                  <h3>{sig.name}</h3>
                </div>
                <div className="row" style={{ gap: 8, alignItems: "center" }}>
                  <span className="num" style={{ fontWeight: 650 }}>{Number.isFinite(c.value) ? `${fmt(c.value, sig.decimals)} ${sig.unit}` : "–"}</span>
                  <Light level={c.level} />
                </div>
              </div>
              <p className="small ink2" style={{ maxWidth: "85ch" }}>{sig.why}</p>
              <p className="small muted" style={{ margin: "4px 0 10px" }}>Rule: {sig.rule}. Latest reading {monthLabel(c.asOf)}.</p>
              <TvChart
                dates={dates}
                series={series}
                persistKey={`top-${sig.id}`}
                ariaLabel={`${sig.name} history`}
                format={cfg.format}
                refLines={cfg.refs}
                leftLog
                defaultRange="All"
                height={340}
              />
            </div>
          );
        })}
      </div>

      <div className="section card prose small ink2">
        <h3>Sources and caveats</h3>
        <p>
          CAPE, ECY and the monthly S&amp;P 500 come from Robert Shiller&rsquo;s data (shillerdata.com), with multpl.com as a backup. Margin debt is FINRA&rsquo;s
          monthly report. Everything else is from FRED: Fed Z.1 equity values and GDP (Buffett indicator), 10Y−2Y spread, fed funds, Moody&rsquo;s Baa spread,
          real-time Sahm rule. Monthly and quarterly sources lag by 1–3 months; each light shows the month it was last updated.
        </p>
        <p>
          This is a probability tool, not a crystal ball. Expensive markets can stay expensive for years, and some crashes (1987, 2020) come from shocks no
          gauge sees. Use it to decide how much to hedge and when to stop buying dips, not to go all-in or all-out on one reading.
        </p>
      </div>
    </>
  );
}
