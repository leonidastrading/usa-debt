"use client";

import { useMemo } from "react";
import TvChart from "@/components/TvChart";
import { usePersisted } from "@/lib/usePersisted";

type Tenor = { id: string; name: string; yields: number[]; prices: number[] };

const COLORS: Record<string, string> = { "2y": "var(--s3)", "10y": "var(--s1)", "30y": "var(--s2)" };

export default function BondChart({ dates, tenors }: { dates: string[]; tenors: Tenor[] }) {
  const [mode, setMode] = usePersisted<"price" | "yield">("bond-chart:mode", "price");
  const series = useMemo(
    () => tenors.map((t) => ({ id: t.id, name: t.name, color: COLORS[t.id], values: mode === "price" ? t.prices : t.yields })),
    [tenors, mode],
  );
  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <p className="small muted" style={{ maxWidth: "70ch" }}>
          {mode === "price"
            ? "Price of a Treasury held at constant maturity, rebased to 100 at the left edge of the view. Falling line = bondholders losing money; the 30-year moves most."
            : "Constant-maturity Treasury yields. Yields up = prices down."}
        </p>
        <div className="seg" role="group" aria-label="Show">
          <button aria-pressed={mode === "price"} onClick={() => setMode("price")}>Price</button>
          <button aria-pressed={mode === "yield"} onClick={() => setMode("yield")}>Yield</button>
        </div>
      </div>
      <TvChart
        key={mode}
        dates={dates}
        series={series}
        persistKey="bond-chart"
        ariaLabel={mode === "price" ? "Treasury bond price indices" : "Treasury yields"}
        format={mode === "price" ? "index" : "pct"}
        priceMode={mode === "price" ? "indexed" : "normal"}
        height={420}
        help="Scroll to zoom, drag to pan. Price excludes coupon income."
      />
    </div>
  );
}
