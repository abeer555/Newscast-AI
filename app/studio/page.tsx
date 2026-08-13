"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, fmtDuration, timeAgo } from "@/lib/store";

interface Ep { id: string; title: string; status: string; format: string; language: string; audio_duration: number | null; created_at: number; evaluation: { overall: number } | null; }

export default function StudioIndex() {
  const [eps, setEps] = useState<Ep[]>([]);
  useEffect(() => { void api<{ episodes: Ep[] }>("/api/episodes").then((j) => setEps(j.episodes)); }, []);
  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Studio</h1>
          <div className="page-sub">Pick an episode to edit its script, re-synthesize voices, or review quality.</div>
        </div>
        <Link href="/" className="btn primary">＋ New from a story</Link>
      </div>
      <div className="card">
        {eps.length === 0 && <div style={{ padding: 50, textAlign: "center" }} className="muted">No episodes yet. Produce one from any story.</div>}
        {eps.map((e) => (
          <Link href={`/studio/${e.id}`} key={e.id} className="story-row" style={{ gridTemplateColumns: "1fr auto" }}>
            <div>
              <div className="story-title">{e.title}</div>
              <div className="story-meta">
                <span className="chip ai">{e.format}</span>
                <span className="chip">{e.format}</span>
                <span className="chip src">{e.status}</span>
                {e.evaluation && <span className="chip good">★ {e.evaluation.overall}</span>}
                <span>{fmtDuration(e.audio_duration)} · {timeAgo(e.created_at)}</span>
              </div>
            </div>
            <span className="dim">→</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
