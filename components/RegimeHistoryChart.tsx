"use client";

import TvChart, { type TvSeries } from "@/components/TvChart";

const REF_LINES = [{ price: 95, title: "Alert 95" }, { price: 85, title: "Elevated 85" }];
const FIXED: [number, number] = [0, 100];

export default function RegimeHistoryChart({ dates, series, events, height = 600 }: {
  dates: string[];
  series: TvSeries[];
  events: { date: string; label: string }[];
  height?: number;
}) {
  return (
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
  );
}
