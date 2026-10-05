"use client";

// Regime history on TradingView Lightweight Charts: pan/zoom, crosshair, price lines for
// the alert levels and markers for past stress events.
import { useEffect, useRef, useState } from "react";
import type { IChartApi, ISeriesApi, Time } from "lightweight-charts";
import { usePersisted } from "@/lib/usePersisted";

type Series = { id: string; name: string; color: string; values: number[] };

type Props = {
  dates: string[];
  series: Series[];
  events: { date: string; label: string }[];
  height?: number;
};

const RANGES = [
  { id: "1Y", years: 1 },
  { id: "3Y", years: 3 },
  { id: "10Y", years: 10 },
  { id: "All", years: 0 },
];

/** Resolve "var(--s1)" (or a plain color) to a concrete color the canvas can use. */
function resolve(color: string): string {
  const m = color.match(/^var\((--[\w-]+)\)$/);
  if (!m) return color;
  return getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() || "#888";
}

function theme() {
  return {
    bg: resolve("var(--surface)"),
    text: resolve("var(--muted)"),
    grid: resolve("var(--grid)"),
    axis: resolve("var(--axis)"),
    ink: resolve("var(--ink-2)"),
  };
}

export default function RegimeHistoryChart({ dates, series, events, height = 600 }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
  // Remembered across visits: preset range ("custom" after a manual zoom/pan), the exact
  // custom window, and which series are switched off.
  const [range, setRange] = usePersisted("regime-chart:range", "3Y");
  const [view, setView] = usePersisted<{ from: string; to: string } | null>("regime-chart:view", null);
  const [hiddenList, setHiddenList] = usePersisted<string[]>("regime-chart:hidden", []);
  const hidden = new Set(hiddenList);
  const [hover, setHover] = useState<{ date: string; values: Record<string, number> } | null>(null);
  // Mirrors of state for use inside the chart's (re)build callback.
  const rangeRef = useRef(range);
  const viewRef = useRef(view);
  const hiddenRef = useRef(hidden);
  rangeRef.current = range;
  viewRef.current = view;
  hiddenRef.current = hidden;
  // Range changes we make ourselves (presets, rebuilds, resizes) are not user zooms.
  const quietUntil = useRef(0);

  // Build the chart once; rebuild if the data or the colour scheme changes.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let disposed = false;
    let cleanup = () => {};

    (async () => {
      const lw = await import("lightweight-charts");
      if (disposed) return;

      const build = () => {
        const t = theme();
        const chart = lw.createChart(el, {
          height,
          autoSize: true,
          layout: { background: { type: lw.ColorType.Solid, color: t.bg }, textColor: t.text, fontSize: 11, fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif" },
          grid: { vertLines: { visible: false }, horzLines: { color: t.grid } },
          rightPriceScale: { borderColor: t.axis, scaleMargins: { top: 0.06, bottom: 0.04 } },
          timeScale: { borderColor: t.axis, rightOffset: 2 },
          // Mouse wheel zooms, drag pans, pinch zooms on touch.
          handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
          handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: { time: true, price: false } },
          crosshair: {
            mode: lw.CrosshairMode.Magnet,
            vertLine: { color: t.ink, labelBackgroundColor: t.ink },
            horzLine: { color: t.ink, labelBackgroundColor: t.ink },
          },
          localization: { locale: "en-US", priceFormatter: (p: number) => p.toFixed(0) },
        });

        const map = new Map<string, ISeriesApi<"Line">>();
        series.forEach((s, k) => {
          const line = chart.addSeries(lw.LineSeries, {
            color: resolve(s.color),
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: true,
            title: "",
            autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
          });
          line.setData(
            dates.map((d, i) => (Number.isFinite(s.values[i]) ? { time: d as Time, value: s.values[i] } : { time: d as Time })),
          );
          if (k === 0) {
            for (const lvl of [{ price: 95, title: "Alert 95" }, { price: 85, title: "Elevated 85" }]) {
              line.createPriceLine({ price: lvl.price, color: t.axis, lineWidth: 1, lineStyle: lw.LineStyle.Dashed, axisLabelVisible: false, title: lvl.title });
            }
            // Snap each event to the first sampled date on or after it.
            const markers = events
              .map((e) => ({ e, d: dates.find((x) => x >= e.date) }))
              .filter((x): x is { e: { date: string; label: string }; d: string } => !!x.d)
              .map(({ e, d }) => ({ time: d as Time, position: "aboveBar" as const, shape: "arrowDown" as const, color: t.ink, text: e.label }));
            lw.createSeriesMarkers(line, markers);
          }
          map.set(s.id, line);
        });

        chart.subscribeCrosshairMove((p) => {
          if (!p.time || !p.point) { setHover(null); return; }
          const values: Record<string, number> = {};
          for (const [id, line] of map) {
            const d = p.seriesData.get(line) as { value?: number } | undefined;
            if (d?.value != null) values[id] = d.value;
          }
          setHover({ date: String(p.time), values });
        });

        // Remember manual zooms/pans (debounced) as a "custom" window.
        let saveTimer: ReturnType<typeof setTimeout> | undefined;
        chart.timeScale().subscribeVisibleTimeRangeChange((r) => {
          if (!r || Date.now() < quietUntil.current) return;
          clearTimeout(saveTimer);
          saveTimer = setTimeout(() => {
            setView({ from: String(r.from), to: String(r.to) });
            setRange("custom");
          }, 400);
        });

        chartRef.current = chart;
        seriesRef.current = map;
        applyRange(rangeRef.current);
        applyHidden(hiddenRef.current);
        return chart;
      };

      let chart = build();
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const onScheme = () => { chart.remove(); chart = build(); };
      mq.addEventListener("change", onScheme);
      // A resize shifts the visible window too; don't record that as a user zoom.
      const ro = new ResizeObserver(() => { quietUntil.current = Date.now() + 600; });
      ro.observe(el);
      cleanup = () => { ro.disconnect(); mq.removeEventListener("change", onScheme); chart.remove(); chartRef.current = null; };
    })();

    return () => { disposed = true; cleanup(); };
  }, [dates, series, events, height]);

  function applyRange(id: string) {
    const chart = chartRef.current;
    if (!chart || !dates.length) return;
    quietUntil.current = Date.now() + 600;
    if (id === "custom") {
      const v = viewRef.current;
      if (v) chart.timeScale().setVisibleRange({ from: v.from as Time, to: v.to as Time });
      return;
    }
    const yrs = RANGES.find((r) => r.id === id)?.years ?? 0;
    if (!yrs) { chart.timeScale().fitContent(); return; }
    const last = dates[dates.length - 1];
    const from = new Date(Date.parse(last) - yrs * 365.25 * 86400000).toISOString().slice(0, 10);
    chart.timeScale().setVisibleRange({ from: (dates.find((d) => d >= from) ?? dates[0]) as Time, to: last as Time });
  }

  function applyHidden(h: Set<string>) {
    for (const [id, line] of seriesRef.current) line.applyOptions({ visible: !h.has(id) });
  }

  useEffect(() => applyRange(range), [range]);
  useEffect(() => applyHidden(new Set(hiddenList)), [hiddenList]);

  const latest = Object.fromEntries(series.map((s) => {
    for (let i = s.values.length - 1; i >= 0; i--) if (Number.isFinite(s.values[i])) return [s.id, s.values[i]];
    return [s.id, NaN];
  }));
  const shown = hover?.values ?? latest;

  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <div className="legend" role="group" aria-label="Series" style={{ marginBottom: 0 }}>
          {series.map((s) => (
            <button
              key={s.id}
              aria-pressed={!hidden.has(s.id)}
              onClick={() => setHiddenList((prev) => (prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id]))}
            >
              <span className="line-key" style={{ background: s.color }} />
              {s.name}
              <strong className="num" style={{ color: "var(--ink)", minWidth: 20 }}>
                {Number.isFinite(shown[s.id]) ? Math.round(shown[s.id]) : "–"}
              </strong>
            </button>
          ))}
          <span className="muted num">{hover ? new Date(hover.date + "T00:00:00Z").toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }) : "latest"}</span>
        </div>
        <div className="seg" role="group" aria-label="Range">
          {RANGES.map((r) => (
            <button key={r.id} aria-pressed={range === r.id} onClick={() => { setView(null); setRange(r.id); if (range === r.id) applyRange(r.id); }}>{r.id}</button>
          ))}
        </div>
      </div>
      <div ref={box} style={{ height, width: "100%", position: "relative" }} role="img" aria-label="Regime scores over time" />
      <p className="small muted" style={{ marginTop: 8 }}>Scroll to zoom, drag to pan, pick a range button to reset. Your zoom and series choices are remembered. Arrows mark past stress events.</p>
    </div>
  );
}
