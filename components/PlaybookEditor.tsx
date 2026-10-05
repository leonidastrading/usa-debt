"use client";

import { useEffect, useState } from "react";
import { DEFAULT_PLAYBOOK, loadPlaybook, savePlaybook, type Playbook } from "@/lib/playbook";
import { REGIME_COLORS } from "@/lib/format";

type R = { id: string; name: string; tagline: string; score: number; alertRate: number };

export default function PlaybookEditor({ regimes }: { regimes: R[] }) {
  const [pb, setPb] = useState<Playbook>(DEFAULT_PLAYBOOK);
  useEffect(() => setPb(loadPlaybook()), []);

  // Every edit is saved immediately.
  const update = (next: Playbook) => {
    setPb(next);
    savePlaybook(next);
  };
  const set = (id: string, patch: Partial<Playbook[string]>) => update({ ...pb, [id]: { ...pb[id], ...patch } });

  return (
    <div>
      <div className="grid grid-2">
        {regimes.map((r) => (
          <div key={r.id} className="card">
            <div className="regime-top">
              <div className="regime-name"><span className="swatch" style={{ background: REGIME_COLORS[r.id] }} /><h3>{r.name}</h3></div>
              <span className="small muted num">now {Number.isFinite(r.score) ? Math.round(r.score) : "–"}</span>
            </div>
            <p className="small ink2" style={{ margin: "4px 0 10px" }}>{r.tagline}</p>
            <label className="field" style={{ marginBottom: 10 }}>
              Trigger when score ≥ {pb[r.id]?.threshold}
              <input
                type="range" min={60} max={99} value={pb[r.id]?.threshold ?? 85}
                onChange={(e) => set(r.id, { threshold: Number(e.target.value) })}
                aria-label={`${r.name} threshold`}
              />
            </label>
            <label className="field">
              Actions (one per line)
              <textarea rows={6} value={pb[r.id]?.actions ?? ""} onChange={(e) => set(r.id, { actions: e.target.value })} />
            </label>
          </div>
        ))}
      </div>
      <div className="row" style={{ marginTop: 16 }}>
        <span className="small muted">Changes save automatically in this browser.</span>
        <button className="btn ghost" onClick={() => { if (confirm("Replace your playbook with the defaults?")) update(DEFAULT_PLAYBOOK); }}>Restore defaults</button>
      </div>
      <p className="small muted" style={{ marginTop: 12 }}>
        Tip: a threshold of 85 fires on roughly 1 day in 7 historically, 95 on roughly 1 in 20. If a playbook fires every week you will stop reading it;
        raise the threshold until it only fires when you would actually act.
      </p>
    </div>
  );
}
