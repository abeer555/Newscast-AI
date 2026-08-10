"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, timeAgo, fmtDuration, useInterval } from "@/lib/store";

interface Story {
  id: string;
  title: string;
  category: string;
  trend_score: number;
  velocity: number;
  article_count: number;
  source_count: number;
  sources: string[];
  last_updated: number;
  image_url?: string | null;
  summary?: string | null;
  india_origin?: boolean;
}

export default function IndiaPage() {
  const [stories, setStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<"trend" | "recent" | "coverage">("trend");

  const load = async () => {
    const j = await api<{ stories: Story[] }>(`/api/stories/india?sort=${sort}&limit=40`);
    setStories(j.stories);
    setLoading(false);
  };
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [sort]);
  useInterval(load, 45_000);

  const max = Math.max(1, ...stories.map((s) => s.trend_score));

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">🇮🇳 India Desk</h1>
          <div className="page-sub">Stories from Indian outlets (The Hindu, NDTV, ThePrint, Scroll, India Today, and more). Auto-refreshes every 45s.</div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {(["trend", "recent", "coverage"] as const).map((s) => (
            <button key={s} className={`btn sm ${sort === s ? "" : "outline"}`} onClick={() => setSort(s)}>
              {s === "trend" ? "🔥 Trending" : s === "recent" ? "🕐 Recent" : "📡 Coverage"}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="skeleton" style={{ height: 400 }} />
      ) : stories.length === 0 ? (
        <div className="card pad" style={{ textAlign: "center", padding: 60 }}>
          <div style={{ fontSize: 42, marginBottom: 12 }}>🗞</div>
          <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>No Indian coverage yet</div>
          <div className="muted">Feeds are still priming. Try the Command Deck while the Indian sources (The Hindu, NDTV, ThePrint…) catch up.</div>
        </div>
      ) : (
        <div className="grid c2" style={{ alignItems: "start" }}>
          {stories.map((s, i) => (
            <Link key={s.id} href={`/story/${s.id}`} className="card pad" style={{ position: "relative", overflow: "hidden" }}>
              {/* heat bar */}
              <div style={{
                position: "absolute", left: 0, top: 0, bottom: 0,
                width: `${(s.trend_score / max) * 100}%`,
                background: `linear-gradient(90deg, rgba(255,159,67,${0.10 + 0.1 * (s.trend_score / max)}), transparent)`,
                pointerEvents: "none",
              }} />
              <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                <div className={`rank ${i < 3 ? "hot" : ""}`} style={{ fontSize: 26, minWidth: 34, color: i < 3 ? "var(--accent)" : "var(--text-3)" }}>{i + 1}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="story-title" style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                    <div style={{ flex: 1 }}>{s.title}</div>
                    {s.india_origin && (
                      <span className="chip" style={{ flexShrink: 0, fontSize: 10.5, padding: "2px 8px", background: "rgba(255,159,67,0.15)", color: "var(--accent-2)" }}>🇮🇳</span>
                    )}
                  </div>
                  <div className="story-meta">
                    <span className="chip cat">{s.category}</span>
                    <span className="chip">{s.source_count} source{s.source_count === 1 ? "" : "s"}</span>
                    <span>{timeAgo(s.last_updated)}</span>
                  </div>
                  {s.sources.length > 0 && (
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", margin: "8px 0 0" }}>
                      {s.sources.slice(0, 4).map((src) => (
                        <span key={src} className="chip src" style={{ fontSize: 10.5 }}>{src}</span>
                      ))}
                      {s.sources.length > 4 && <span className="dim" style={{ fontSize: 11.5 }}>+{s.sources.length - 4} more</span>}
                    </div>
                  )}
                  {s.summary && (
                    <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.55, marginTop: 8 }}>{s.summary.slice(0, 140)}{s.summary.length > 140 ? "…" : ""}</p>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
