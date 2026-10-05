export default function Sparkline({ values, color = "var(--ink-2)", height = 36 }: { values: number[]; color?: string; height?: number }) {
  const pts = values.map((v, i) => [i, v] as const).filter(([, v]) => Number.isFinite(v));
  if (pts.length < 2) return <div style={{ height }} />;
  const w = 200;
  const lo = Math.min(...pts.map((p) => p[1]));
  const hi = Math.max(...pts.map((p) => p[1]));
  const n = values.length - 1 || 1;
  const x = (i: number) => (i / n) * w;
  const y = (v: number) => 3 + (height - 6) * (1 - (v - lo) / (hi - lo || 1));
  const d = pts.map(([i, v], k) => `${k ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const [li, lv] = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" width="100%" height={height} aria-hidden="true" style={{ display: "block", overflow: "visible" }}>
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      <circle cx={x(li)} cy={y(lv)} r={2.5} fill={color} />
    </svg>
  );
}
