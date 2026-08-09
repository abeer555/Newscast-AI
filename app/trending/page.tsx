"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, timeAgo, useInterval } from "@/lib/store";

interface Story {
  id: string; title: string; category: string; trend_score: number; velocity: number;
  article_count: number; source_count: number; sources: string[]; last_updated: number; spark?: number[];
}

export default function TrendingPage() {
  const [stories, setStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const j = await api<{ stories: Story[] }>("/api/stories?sort=trend&limit=24");
    setStories(j.stories);
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);
  useInterval(load, 30000);

  const max = Math.max(1, ...stories.map((s) => s.trend_score));

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Trending</h1>
          <div className="page-sub">Ranked by coverage breadth × velocity × recency. Auto-refreshes every 30s.</div>
        </div>
      </div>
      {loading ? <div className="skeleton" style={{ height: 400 }} /> : (
        <div className="grid c2" style={{ alignItems: "start" }}>
          {stories.map((s, i) => (
            <Link href={`/story/${s.id}`} key={s.id} className="card pad" style={{ position: "relative", overflow: "hidden" }}>
              {/* heat bar */}
              <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${(s.trend_score / max) * 100}%`, background: `linear-gradient(90deg, rgba(255,91,127,${0.10 + 0.1 * (s.trend_score / max)}), transparent)`, pointerEvents: "none" }} />
              <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                <div className={`rank ${i < 3 ? "hot" : ""}`} style={{ fontSize: 26, minWidth: 34 }}>{i + 1}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 650, fontSize: 15, lineHeight: 1.4, marginBottom: 8 }}>{s.title}</div>
                  <div style={{ display: "flex", gap: 7, flexWrap: "wrap", fontSize: 12 }}>
                    <span className="chip cat">{s.category}</span>
                    <span className="chip src">{s.source_count} sources</span>
                    <span className="chip">{s.article_count} articles</span>
                    <span className="chip trend">▲ velocity {s.velocity}/h</span>
                    <span className="dim">{timeAgo(s.last_updated)}</span>
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 800, color: i < 3 ? "var(--hot)" : "var(--text)" }}>{Math.round(s.trend_score)}</div>
                  <div className="score-label">heat</div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
