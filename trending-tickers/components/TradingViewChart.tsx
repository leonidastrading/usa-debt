"use client";

// TradingView's Advanced Chart widget: a live, interactive chart streamed from TradingView.
// Each one is a heavy iframe, so it loads only when its card scrolls near the viewport.
import { useEffect, useRef, useState } from "react";

export default function TradingViewChart({ symbol }: { symbol: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setDark(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const el = box.current;
    if (!el || visible) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  useEffect(() => {
    const el = box.current;
    if (!el || !visible) return;
    el.innerHTML = "";
    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget";
    widget.style.height = "100%";
    widget.style.width = "100%";
    el.appendChild(widget);
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol,
      interval: "15",
      range: "5D",
      timezone: "America/New_York",
      theme: dark ? "dark" : "light",
      style: "1",
      locale: "en",
      backgroundColor: dark ? "#1a1a19" : "#fcfcfb",
      withdateranges: true,
      allow_symbol_change: false,
      hide_side_toolbar: true,
      details: false,
      calendar: false,
      save_image: false,
      support_host: "https://www.tradingview.com",
    });
    el.appendChild(script);
  }, [symbol, visible, dark]);

  return (
    <div className="chart">
      <div ref={box} className="tradingview-widget-container" style={{ height: "100%", width: "100%" }}>
        <div className="chart-placeholder">Loading {symbol} chart…</div>
      </div>
    </div>
  );
}
