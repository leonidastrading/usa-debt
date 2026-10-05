"use client";

import { useState } from "react";
import type { NewsItem } from "@/lib/news";

function ago(iso: string) {
  if (!iso) return "";
  const h = (Date.now() - Date.parse(iso)) / 3600000;
  if (h < 1) return "just now";
  if (h < 24) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export default function NewsList({ items, topics }: { items: NewsItem[]; topics: { id: string; label: string }[] }) {
  const [topic, setTopic] = useState("all");
  const [limit, setLimit] = useState(50);
  const shown = topic === "all" ? items : items.filter((i) => i.topic === topic);
  const label = Object.fromEntries(topics.map((t) => [t.id, t.label]));
  return (
    <div>
      <div className="row" style={{ gap: 6, marginBottom: 12 }} role="group" aria-label="Topic">
        <button className="chip" aria-pressed={topic === "all"} onClick={() => setTopic("all")}>All ({items.length})</button>
        {topics.map((t) => (
          <button key={t.id} className="chip" aria-pressed={topic === t.id} onClick={() => setTopic(t.id)}>
            {t.label} ({items.filter((i) => i.topic === t.id).length})
          </button>
        ))}
      </div>
      <div className="card">
        {shown.length === 0 && <p className="small muted">No headlines.</p>}
        {shown.slice(0, limit).map((i) => (
          <div key={i.link + i.title} className="news-item">
            <a href={i.link} target="_blank" rel="noopener noreferrer">{i.title}</a>
            <div className="news-meta">
              <span>{i.source}</span>
              <span>·</span>
              <span suppressHydrationWarning>{ago(i.published)}</span>
              <span>·</span>
              <span>{label[i.topic]}</span>
            </div>
          </div>
        ))}
        {shown.length > limit && (
          <button className="btn" style={{ marginTop: 12 }} onClick={() => setLimit((l) => l + 50)}>
            Show more ({shown.length - limit} left)
          </button>
        )}
      </div>
    </div>
  );
}
