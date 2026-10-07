"use client";

import { useMemo } from "react";
import TvChart, { type TvSeries } from "@/components/TvChart";
import { usePersisted } from "@/lib/usePersisted";

const REF_LINES = [{ price: 95, title: "Alert 95" }, { price: 85, title: "Elevated 85" }];
const FIXED: [number, number] = [0, 100];

/**
 * Composite of the regime scores you tick: their average, or the highest (worst) regime
 * each day. Independent of which lines are hidden on the main chart.
 */
function Composite({ dates, parts, overlays }: { dates: string[]; parts: TvSeries[]; overlays: TvSeries[] }) {
  const [picked, setPicked] = usePersisted<string[]>("composite:parts", parts.map((p) => p.id));
  const [mode, setMode] = usePersisted<"avg" | "max">("composite:mode", "avg");
  const activeKey = parts.filter((p) => picked.includes(p.id)).map((p) => p.id).join(",");

  // Keyed on the ticked ids (a string) so the chart only rebuilds when the selection changes.
  const { active, series } = useMemo(() => {
    const active = parts.filter((p) => activeKey.split(",").includes(p.id));
    const values = dates.map((_, i) => {
      const vs = active.map((p) => p.values[i]).filter(Number.isFinite);
      if (!vs.length) return NaN;
      const v = mode === "max" ? Math.max(...vs) : vs.reduce((a, b) => a + b, 0) / vs.length;
      return Math.round(v * 10) / 10;
    });
    const series: TvSeries[] = [
      { id: "composite", name: mode === "max" ? "Highest regime" : "Composite", color: "var(--ink)", values },
      ...overlays,
    ];
    return { active, series };
  }, [dates, parts, overlays, activeKey, mode]);

  const toggle = (id: string) => setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--grid)" }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div>
          <h3>Composite</h3>
          <p className="small muted">One line built from the regimes you tick, whatever is shown on the chart above.</p>
        </div>
        <div className="seg" role="group" aria-label="Combine by">
          <button aria-pressed={mode === "avg"} onClick={() => setMode("avg")}>Average</button>
          <button aria-pressed={mode === "max"} onClick={() => setMode("max")}>Highest</button>
        </div>
      </div>
      <div className="row" role="group" aria-label="Include in composite" style={{ gap: 6, marginBottom: 10 }}>
        {parts.map((p) => (
          <label key={p.id} className="chip" aria-pressed={picked.includes(p.id)}>
            <input
              type="checkbox"
              checked={picked.includes(p.id)}
              onChange={() => toggle(p.id)}
              style={{ display: "inline-block", margin: 0, accentColor: "var(--ink)" }}
            />
            <span className="swatch" style={{ background: p.color }} />
            {p.name}
          </label>
        ))}
      </div>
      {active.length ? (
        <TvChart
          key={mode}
          dates={dates}
          series={series}
          persistKey="composite-chart"
          ariaLabel="Composite regime score"
          format="score"
          height={640}
          fixedRange={FIXED}
          refLines={REF_LINES}
          help={mode === "max"
            ? "Each day's highest score among the ticked regimes: is any of them flashing?"
            : `Average of ${active.map((p) => p.name).join(", ")}. Scroll to zoom, drag to pan.`}
        />
      ) : (
        <p className="small muted" style={{ padding: "40px 0", textAlign: "center" }}>Tick at least one regime to build the composite.</p>
      )}
    </div>
  );
}

export default function RegimeHistoryChart({ dates, series, events, height = 600 }: {
  dates: string[];
  series: TvSeries[];
  events: { date: string; label: string }[];
  height?: number;
}) {
  // The composite uses the regime scores only, not optional overlays like the S&P 500 or VIX.
  const parts = useMemo(() => series.filter((s) => !s.optional), [series]);
  // The S&P 500 can be overlaid on the composite too (switched on from its legend).
  const overlays = useMemo(() => series.filter((s) => s.id === "spx"), [series]);
  return (
    <>
      <TvChart
        dates={dates}
        series={series}
        events={events}
        persistKey="regime-chart"
        ariaLabel="Regime scores over time"
        format="score"
        height={height}
        fixedRange={FIXED}
        refLines={REF_LINES}
        help="Scroll to zoom, drag to pan, pick a range button to reset. Your zoom and series choices are remembered. Arrows mark past stress events."
      />
      <Composite dates={dates} parts={parts} overlays={overlays} />
    </>
  );
}
