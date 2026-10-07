"use client";

// Time-series chart on TradingView Lightweight Charts, shared by every history chart:
// wheel zoom, drag pan, crosshair values in the legend, optional reference lines and event
// markers. Range, zoom window and hidden series are remembered per `persistKey`.
import { useEffect, useRef, useState } from "react";
import type { IChartApi, ISeriesApi, Time } from "lightweight-charts";
import { usePersisted } from "@/lib/usePersisted";

export type TvSeries = {
  id: string;
  name: string;
  color: string;
  values: number[];
  /** Plot on its own left-hand axis (for a series on a different scale). */
  leftAxis?: boolean;
  /** Hidden until the user switches it on. */
  optional?: boolean;
  /** Legend/axis format for this series, if different from the chart's. */
  format?: TvFormat;
  lineWidth?: 1 | 2 | 3;
  lineStyle?: "solid" | "dashed" | "dotted";
  /** Draw as a step line (for rates set in discrete moves). */
  step?: boolean;
};

export type TvFormat = "score" | "pct" | "pct0" | "trillions" | "index" | "level";

type Props = {
  dates: string[];
  series: TvSeries[];
  /** localStorage key prefix for range/zoom/hidden series. */
  persistKey: string;
  ariaLabel: string;
  format?: TvFormat;
  height?: number;
  defaultRange?: string;
  /** Pin the price axis to this range (e.g. 0–100 for scores). */
  fixedRange?: [number, number];
  refLines?: { price: number; title: string }[];
  events?: { date: string; label: string }[];
  /** "indexed": rebase every series to 100 at the left edge of the visible range. */
  priceMode?: "normal" | "indexed";
  /** Log scale for the left axis (e.g. the S&P 500 over decades). */
  leftLog?: boolean;
  help?: string;
};

// Stable defaults: the chart rebuilds when these props change identity.
const NO_LINES: { price: number; title: string }[] = [];
const NO_EVENTS: { date: string; label: string }[] = [];

const FORMATS: Record<TvFormat, { axis: (v: number) => string; legend: (v: number) => string }> = {
  score: { axis: (v) => v.toFixed(0), legend: (v) => v.toFixed(0) },
  pct: { axis: (v) => `${v.toFixed(2)}%`, legend: (v) => `${v.toFixed(2)}%` },
  trillions: { axis: (v) => `$${v.toFixed(v < 10 ? 2 : 1)}T`, legend: (v) => `$${v.toFixed(2)}T` },
  index: { axis: (v) => v.toFixed(1), legend: (v) => v.toFixed(1) },
  pct0: { axis: (v) => `${v.toFixed(0)}%`, legend: (v) => `${v.toFixed(0)}%` },
  level: { axis: (v) => Math.round(v).toLocaleString("en-US"), legend: (v) => Math.round(v).toLocaleString("en-US") },
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

export default function TvChart({
  dates, series, persistKey, ariaLabel, format = "index", height = 400, defaultRange = "3Y",
  fixedRange, refLines = NO_LINES, events = NO_EVENTS, priceMode = "normal", leftLog = false, help,
}: Props) {
  const fmt = FORMATS[format];
  const box = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
  // Remembered across visits: preset range ("custom" after a manual zoom/pan), the exact
  // custom window, and which series are switched off.
  const [range, setRange] = usePersisted(`${persistKey}:range`, defaultRange);
  const [view, setView] = usePersisted<{ from: string; to: string } | null>(`${persistKey}:view`, null);
  const [hiddenList, setHiddenList] = usePersisted<string[]>(`${persistKey}:hidden`, []);
  // Optional series are tracked the other way round: off unless switched on.
  const [shownList, setShownList] = usePersisted<string[]>(`${persistKey}:shown`, []);
  const hidden = new Set(series.filter((s) => (s.optional ? !shownList.includes(s.id) : hiddenList.includes(s.id))).map((s) => s.id));
  const toggle = (s: TvSeries) => {
    const flip = (prev: string[]) => (prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id]);
    if (s.optional) setShownList(flip); else setHiddenList(flip);
  };
  const [hover, setHover] = useState<{ date: string; values: Record<string, number> } | null>(null);
  // Index of the first visible bar; in "indexed" mode legend values are rebased to it, like the axis.
  const [baseIdx, setBaseIdx] = useState(0);
  // Mirrors of state for use inside the chart's (re)build callback.
  const rangeRef = useRef(range);
  const viewRef = useRef(view);
  const hiddenRef = useRef(hidden);
  rangeRef.current = range;
  viewRef.current = view;
  hiddenRef.current = hidden;
  // Range changes we make ourselves (presets, rebuilds, resizes) are not user zooms.
  const quietUntil = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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
          rightPriceScale: {
            borderColor: t.axis,
            scaleMargins: { top: 0.06, bottom: 0.04 },
            mode: priceMode === "indexed" ? lw.PriceScaleMode.IndexedTo100 : lw.PriceScaleMode.Normal,
          },
          leftPriceScale: {
            visible: false, borderColor: t.axis, scaleMargins: { top: 0.06, bottom: 0.04 },
            mode: leftLog ? lw.PriceScaleMode.Logarithmic : lw.PriceScaleMode.Normal,
          },
          // Allow very dense bars so "All" can fit 20 years of daily data.
          timeScale: { borderColor: t.axis, rightOffset: 2, minBarSpacing: 0.01 },
          // Mouse wheel zooms, drag pans, pinch zooms on touch.
          handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
          handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: { time: true, price: false } },
          crosshair: {
            mode: lw.CrosshairMode.Magnet,
            vertLine: { color: t.ink, labelBackgroundColor: t.ink },
            horzLine: { color: t.ink, labelBackgroundColor: t.ink },
          },
          // Formatting is set per series (below) so a left-axis series can use its own units.
          localization: { locale: "en-US" },
        });

        const map = new Map<string, ISeriesApi<"Line">>();
        series.forEach((s, k) => {
          const own = s.format ? FORMATS[s.format] : fmt;
          const line = chart.addSeries(lw.LineSeries, {
            color: resolve(s.color),
            lineWidth: s.lineWidth ?? 2,
            lineType: s.step ? lw.LineType.WithSteps : lw.LineType.Simple,
            lineStyle: s.lineStyle === "dashed" ? lw.LineStyle.Dashed : s.lineStyle === "dotted" ? lw.LineStyle.Dotted : lw.LineStyle.Solid,
            priceLineVisible: false,
            lastValueVisible: true,
            title: "",
            ...(s.leftAxis ? { priceScaleId: "left" } : {}),
            priceFormat: { type: "custom" as const, formatter: own.axis, minMove: 0.01 },
            ...(fixedRange && !s.leftAxis ? { autoscaleInfoProvider: () => ({ priceRange: { minValue: fixedRange[0], maxValue: fixedRange[1] } }) } : {}),
          });
          line.setData(
            dates.map((d, i) => (Number.isFinite(s.values[i]) ? { time: d as Time, value: s.values[i] } : { time: d as Time })),
          );
          if (k === 0) {
            for (const lvl of refLines) {
              line.createPriceLine({ price: lvl.price, color: t.axis, lineWidth: 1, lineStyle: lw.LineStyle.Dashed, axisLabelVisible: false, title: lvl.title });
            }
            // Snap each event to the first sampled date on or after it.
            const markers = events
              .map((e) => ({ e, d: dates.find((x) => x >= e.date) }))
              .filter((x): x is { e: { date: string; label: string }; d: string } => !!x.d)
              .map(({ e, d }) => ({ time: d as Time, position: "aboveBar" as const, shape: "arrowDown" as const, color: t.ink, text: e.label }));
            if (markers.length) lw.createSeriesMarkers(line, markers);
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

        chart.timeScale().subscribeVisibleLogicalRangeChange((r) => {
          if (r) setBaseIdx(Math.max(0, Math.min(dates.length - 1, Math.ceil(r.from))));
        });

        // Remember manual zooms/pans (debounced) as a "custom" window.
        chart.timeScale().subscribeVisibleTimeRangeChange((r) => {
          if (!r || Date.now() < quietUntil.current) return;
          clearTimeout(saveTimer.current);
          saveTimer.current = setTimeout(() => {
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
  }, [dates, series, events, height, format, fixedRange, refLines, priceMode, leftLog]);

  function applyRange(id: string) {
    const chart = chartRef.current;
    if (!chart || !dates.length) return;
    quietUntil.current = Date.now() + 600;
    clearTimeout(saveTimer.current); // a preset beats any half-recorded manual zoom
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
    // Showing/hiding an axis resizes the plot; that's not a user zoom.
    quietUntil.current = Date.now() + 600;
    for (const [id, line] of seriesRef.current) line.applyOptions({ visible: !h.has(id) });
    // The left axis only appears while a series on it is visible.
    const leftOn = series.some((s) => s.leftAxis && !h.has(s.id));
    chartRef.current?.applyOptions({ leftPriceScale: { visible: leftOn } });
  }

  useEffect(() => applyRange(range), [range]);
  const hiddenKey = [...hidden].sort().join(",");
  useEffect(() => applyHidden(new Set(hiddenKey ? hiddenKey.split(",") : [])), [hiddenKey]);

  const latest = Object.fromEntries(series.map((s) => {
    for (let i = s.values.length - 1; i >= 0; i--) if (Number.isFinite(s.values[i])) return [s.id, s.values[i]];
    return [s.id, NaN];
  }));
  const raw = hover?.values ?? latest;
  const shown = priceMode !== "indexed" ? raw : Object.fromEntries(series.map((s) => {
    let base = NaN;
    for (let i = baseIdx; i < s.values.length; i++) if (Number.isFinite(s.values[i])) { base = s.values[i]; break; }
    return [s.id, (100 * raw[s.id]) / base];
  }));

  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <div className="legend" role="group" aria-label="Series" style={{ marginBottom: 0 }}>
          {series.map((s) => (
            <button
              key={s.id}
              aria-pressed={!hidden.has(s.id)}
              onClick={() => toggle(s)}
              title={s.optional ? `Show or hide ${s.name}` : undefined}
            >
              <span
                className="line-key"
                style={s.lineStyle === "dashed"
                  ? { background: `repeating-linear-gradient(90deg, ${s.color} 0 4px, transparent 4px 7px)` }
                  : s.lineStyle === "dotted"
                    ? { background: `repeating-linear-gradient(90deg, ${s.color} 0 2px, transparent 2px 4px)` }
                    : { background: s.color }}
              />
              {s.name}
              <strong className="num" style={{ color: "var(--ink)", minWidth: 20 }}>
                {Number.isFinite(shown[s.id]) ? (s.format ? FORMATS[s.format] : fmt).legend(shown[s.id]) : "–"}
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
      <div ref={box} style={{ height, width: "100%", position: "relative" }} role="img" aria-label={ariaLabel} />
      {help && <p className="small muted" style={{ marginTop: 8 }}>{help}</p>}
    </div>
  );
}
