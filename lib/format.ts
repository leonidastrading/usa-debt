export const REGIME_COLORS: Record<string, string> = {
  fiscal: "var(--s1)",
  liquidity: "var(--s2)",
  inflation: "var(--s3)",
  growth: "var(--s4)",
};

export const STATUS_ICON: Record<string, string> = {
  good: "●",
  warning: "▲",
  serious: "◆",
  critical: "■",
};

export function fmt(v: number | null | undefined, decimals = 2): string {
  if (v == null || !Number.isFinite(v)) return "–";
  return v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function signed(v: number | null | undefined, decimals = 0): string {
  if (v == null || !Number.isFinite(v)) return "–";
  const s = fmt(Math.abs(v), decimals);
  return v > 0 ? `+${s}` : v < 0 ? `−${s}` : s;
}

/** $1.23T / $456B / $7.8M */
export function money(v: number | null | undefined, decimals = 2): string {
  if (v == null || !Number.isFinite(v)) return "–";
  const a = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (a >= 1e12) return `${sign}$${(a / 1e12).toFixed(decimals)}T`;
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(decimals >= 2 ? 0 : decimals)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`;
  return `${sign}$${a.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function dateLabel(iso: string): string {
  if (!iso) return "–";
  return new Date(iso.length === 10 ? iso + "T00:00:00Z" : iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}
