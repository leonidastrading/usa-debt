"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DEFAULT_PLAYBOOK, loadPlaybook, type Playbook } from "@/lib/playbook";
import { STATUS_ICON } from "@/lib/format";

type R = { id: string; name: string; score: number; status: string };

export default function ActivePlaybook({ regimes }: { regimes: R[] }) {
  const [pb, setPb] = useState<Playbook>(DEFAULT_PLAYBOOK);
  useEffect(() => setPb(loadPlaybook()), []);

  const active = regimes.filter((r) => Number.isFinite(r.score) && r.score >= (pb[r.id]?.threshold ?? 85));
  if (!active.length) {
    const nearest = [...regimes].sort((a, b) => (b.score - (pb[b.id]?.threshold ?? 85)) - (a.score - (pb[a.id]?.threshold ?? 85)))[0];
    return (
      <div className="alert info" role="status">
        <span className="icon" aria-hidden="true">✓</span>
        <div>
          <strong>No playbook triggered.</strong>{" "}
          <span className="ink2">
            All regimes are below your thresholds
            {nearest ? <> (closest: {nearest.name} at {Math.round(nearest.score)} vs {pb[nearest.id]?.threshold ?? 85})</> : null}.{" "}
            <Link href="/playbook">Edit playbook</Link>
          </span>
        </div>
      </div>
    );
  }
  return (
    <div>
      {active.map((r) => (
        <div key={r.id} className={`alert ${r.status === "good" ? "warning" : r.status}`} role="alert">
          <span className="icon" aria-hidden="true">{STATUS_ICON[r.status] ?? "▲"}</span>
          <div>
            <strong>{r.name} playbook triggered</strong>{" "}
            <span className="ink2">score {Math.round(r.score)} ≥ your threshold {pb[r.id].threshold}</span>
            <ul>
              {pb[r.id].actions.split("\n").filter(Boolean).map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          </div>
        </div>
      ))}
    </div>
  );
}
