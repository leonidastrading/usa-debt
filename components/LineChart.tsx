"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { money } from "@/lib/format";

export type Series = { id: string; name: string; color: string; values: number[] };

type Props = {
  /** X-axis labels, one per point (ISO dates or category labels). */
  x: string[];
  series: Series[];
  height?: number;
  yMin?: number;
  yMax?: number;
  refLines?: { y: number; label: string }[];
  markers?: { x: string; label: string }[];
  /** Value format (a string so server components can pass it). */
  format?: "score" | "pct" | "money" | "num";
  /** Show date-range buttons (x must be ISO dates). */
  ranges?: boolean;
  xIsDate?: boolean;
  ariaLabel: string;
};

const RANGES = [
  { id: "1Y", years: 1 },
  { id: "3Y", years: 3 },
  { id: "10Y", years: 10 },
  { id: "All", years: 100 },
];

const FORMATS: Record<NonNullable<Props["format"]>, (v: number) => string> = {
  score: (v) => v.toFixed(0),
  pct: (v) => `${v.toFixed(1)}%`,
  money: (v) => money(v, 1),
  num: (v) => v.toFixed(1),
};

function niceTicks(min: number, max: number, count = 5): number[] {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

export default function LineChart({
  x, series, height = 280, yMin, yMax, refLines = [], markers = [], format: fmtKind = "num",
  ranges = false, xIsDate = true, ariaLabel,
}: Props) {
  const format = FORMATS[fmtKind];
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [range, setRange] = useState(ranges ? "3Y" : "All");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const start = useMemo(() => {
    if (!ranges || !xIsDate) return 0;
    const yrs = RANGES.find((r) => r.id === range)?.years ?? 100;
    const last = Date.parse(x[x.length - 1]);
    const cutoff = new Date(last - yrs * 365.25 * 86400000).toISOString().slice(0, 10);
    const i = x.findIndex((d) => d >= cutoff);
    return Math.max(0, i);
  }, [x, range, ranges, xIsDate]);

  const xs = x.slice(start);
  const visible = series.filter((s) => !hidden.has(s.id));
  const vals = visible.flatMap((s) => s.values.slice(start)).filter(Number.isFinite);
  const lo = yMin ?? Math.min(...vals, ...refLines.map((r) => r.y));
  const hi = yMax ?? Math.max(...vals, ...refLines.map((r) => r.y));
  const pad = yMin == null || yMax == null ? (hi - lo) * 0.06 || 1 : 0;
  const y0 = yMin ?? lo - pad;
  const y1 = yMax ?? hi + pad;

  const m = { l: 44, r: 12, t: 14, b: 26 };
  const w = width - m.l - m.r;
  const h = height - m.t - m.b;
  const px = (i: number) => m.l + (xs.length <= 1 ? w / 2 : (i / (xs.length - 1)) * w);
  const py = (v: number) => m.t + h - ((v - y0) / (y1 - y0 || 1)) * h;

  const paths = visible.map((s) => {
    let d = "";
    let pen = false;
    s.values.slice(start).forEach((v, i) => {
      if (!Number.isFinite(v)) { pen = false; return; }
      d += `${pen ? "L" : "M"}${px(i).toFixed(1)},${py(v).toFixed(1)}`;
      pen = true;
    });
    return { s, d };
  });

  const yt = niceTicks(y0, y1, 6);
  const xTickCount = Math.max(2, Math.min(8, Math.floor(w / 110)));
  // Category axes with few points label every point; date axes get evenly spaced ticks.
  const xt = !xIsDate && xs.length <= Math.floor(w / 60)
    ? xs.map((_, i) => i)
    : Array.from({ length: xTickCount }, (_, k) => Math.round((k / (xTickCount - 1)) * (xs.length - 1)));
  const xLabel = (s: string) => {
    if (!xIsDate) return s;
    const spanYears = (Date.parse(xs[xs.length - 1]) - Date.parse(xs[0])) / (365.25 * 86400000);
    const d = new Date(s + "T00:00:00Z");
    return spanYears > 3
      ? String(d.getUTCFullYear())
      : d.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
  };

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = ((e.clientX - rect.left) / rect.width) * width;
    const i = Math.round(((rel - m.l) / w) * (xs.length - 1));
    setHover(i >= 0 && i < xs.length ? i : null);
  };

  const visibleMarkers = markers
    .map((mk) => ({ ...mk, i: xs.findIndex((d) => d >= mk.x) }))
    .filter((mk) => mk.i > 0);

  const tipLeft = hover != null ? px(hover) : 0;

  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
        {series.length > 1 ? (
          <div className="legend" role="group" aria-label="Series">
            {series.map((s) => (
              <button
                key={s.id}
                aria-pressed={!hidden.has(s.id)}
                onClick={() => setHidden((prev) => {
                  const next = new Set(prev);
                  if (next.has(s.id)) next.delete(s.id); else next.add(s.id);
                  return next;
                })}
              >
                <span className="line-key" style={{ background: s.color }} />
                {s.name}
              </button>
            ))}
          </div>
        ) : <span />}
        {ranges && (
          <div className="seg" role="group" aria-label="Range">
            {RANGES.map((r) => (
              <button key={r.id} aria-pressed={range === r.id} onClick={() => setRange(r.id)}>{r.id}</button>
            ))}
          </div>
        )}
      </div>
      <div className="chart" ref={ref}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          height={height}
          role="img"
          aria-label={ariaLabel}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          {yt.map((v) => (
            <g key={v}>
              <line className="gridline" x1={m.l} x2={width - m.r} y1={py(v)} y2={py(v)} />
              <text className="axis-label" x={m.l - 6} y={py(v)} dy="0.32em" textAnchor="end">{format(v)}</text>
            </g>
          ))}
          {xt.map((i, k) => (
            <text key={k} className="axis-label" x={px(i)} y={height - 6} textAnchor={k === 0 ? "start" : k === xt.length - 1 ? "end" : "middle"}>
              {xs[i] ? xLabel(xs[i]) : ""}
            </text>
          ))}
          {refLines.map((r) => (
            <g key={r.label}>
              <line className="ref" x1={m.l} x2={width - m.r} y1={py(r.y)} y2={py(r.y)} />
              <text className="ref-label" x={width - m.r - 2} y={py(r.y) - 4} textAnchor="end">{r.label}</text>
            </g>
          ))}
          {visibleMarkers.map((mk, k) => (
            <g key={mk.x}>
              <line className="marker" x1={px(mk.i)} x2={px(mk.i)} y1={m.t} y2={m.t + h} strokeDasharray="2 3" />
              <text className="marker-label" x={px(mk.i) + 3} y={m.t + 10 + (k % 3) * 12}>{mk.label}</text>
            </g>
          ))}
          {paths.map(({ s, d }) => (
            <path key={s.id} d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {hover != null && (
            <g>
              <line className="crosshair" x1={px(hover)} x2={px(hover)} y1={m.t} y2={m.t + h} />
              {visible.map((s) => {
                const v = s.values[start + hover];
                return Number.isFinite(v) ? (
                  <circle key={s.id} cx={px(hover)} cy={py(v)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
                ) : null;
              })}
            </g>
          )}
        </svg>
        {hover != null && (
          <div
            className="tooltip"
            style={{
              top: 8,
              left: `${(tipLeft / width) * 100}%`,
              transform: tipLeft > width * 0.6 ? "translateX(calc(-100% - 12px))" : "translateX(12px)",
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{xIsDate ? new Date(xs[hover] + "T00:00:00Z").toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }) : xs[hover]}</div>
            {visible.map((s) => (
              <div className="t-row" key={s.id}>
                <span className="t-name"><span className="swatch" style={{ background: s.color }} />{s.name}</span>
                <span className="num">{Number.isFinite(s.values[start + hover]) ? format(s.values[start + hover]) : "–"}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
