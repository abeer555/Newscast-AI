"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, useStore, timeAgo } from "@/lib/store";

interface Story {
  id: string; title: string; category: string; trend_score: number; velocity: number;
  article_count: number; source_count: number; sources: string[]; last_updated: number;
  has_intel: boolean; topics: string[]; summary: string | null; image_url: string | null;
}

export default function Dashboard() {
  const { stats, refreshStats, pushToast, ingestLog } = useStore((s) => ({ stats: s.stats, refreshStats: s.refreshStats, pushToast: s.pushToast, ingestLog: s.ingestLog }));
  const [stories, setStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);
  const [ingesting, setIngesting] = useState(false);
  const [category, setCategory] = useState("all");
  const [mode, setMode] = useState<"trending" | "foryou">("trending");

  const load = async () => {
    setLoading(true);
    const qs = mode === "foryou" ? "personalized=1" : `sort=trend${category !== "all" ? `&category=${category}` : ""}`;
    const j = await api<{ stories: Story[] }>(`/api/stories?${qs}&limit=30`);
    setStories(j.stories);
    setLoading(false);
  };
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [category, mode]);

  const ingest = async () => {
    setIngesting(true);
    try {
      await api("/api/ingest", { method: "POST" });
      pushToast("Fresh cycle complete — feeds scanned & stories clustered", "good");
      await load();
      refreshStats();
    } catch (e) { pushToast(`Ingest failed: ${e}`, "bad"); }
    setIngesting(false);
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Command Deck</h1>
          <div className="page-sub">The world's news — ingested, clustered, understood, and ready to broadcast.</div>
        </div>
        <button className={`btn primary ${ingesting ? "loading" : ""}`} onClick={ingest} disabled={ingesting}>
          {ingesting ? "Scanning" : "Run news cycle"}
        </button>
      </div>

      <div className="grid c4" style={{ marginBottom: 22 }}>
        <StatCard label="Articles" value={stats?.articles} accent="var(--accent-2)" />
        <StatCard label="Story clusters" value={stats?.clusters} accent="var(--accent-3)" />
        <StatCard label="Episodes" value={stats?.episodes} sub={`${stats?.episodes_ready ?? 0} ready`} accent="var(--accent)" />
        <StatCard label="Audio broadcast" value={stats?.audio_minutes != null ? `${stats.audio_minutes}m` : null} sub={`${stats?.plays ?? 0} plays`} accent="var(--warm)" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 20, alignItems: "start" }}>
        <div className="card">
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid var(--line-soft)", flexWrap: "wrap" }}>
            <div style={{ display: "flex", background: "var(--panel-2)", borderRadius: 9, padding: 3 }}>
              {(["trending", "foryou"] as const).map((m) => (
                <button key={m} className="btn sm" onClick={() => setMode(m)}
                  style={{ border: "none", background: mode === m ? "var(--panel-3)" : "transparent", color: mode === m ? "var(--accent)" : "var(--text-2)" }}>
                  {m === "trending" ? "Trending now" : "For you"}
                </button>
              ))}
            </div>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="btn sm" style={{ background: "var(--panel-2)" }}>
              {["all", "politics", "conflict", "technology", "business", "health", "climate", "sports", "science", "general"].map((c) => (
                <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>
              ))}
            </select>
          </div>
          {loading ? (
            <div style={{ padding: 18, display: "grid", gap: 12 }}>
              {[...Array(6)].map((_, i) => <div key={i} className="skeleton" style={{ height: 54 }} />)}
            </div>
          ) : stories.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center" }} className="muted">
              No stories yet. Hit <b>Run news cycle</b> to scan the feeds.
            </div>
          ) : (
            stories.map((s, i) => (
              <Link href={`/story/${s.id}`} key={s.id} className="story-row" style={{ display: "grid" }}>
                <div className={`rank ${i < 3 ? "hot" : ""}`}>{i + 1}</div>
                <div style={{ minWidth: 0 }}>
                  <div className="story-title">{s.title}</div>
                  <div className="story-meta">
                    <span className="chip cat">{s.category}</span>
                    <span className="chip src">{s.source_count} {s.source_count === 1 ? "source" : "sources"}</span>
                    {s.has_intel && <span className="chip ai">intel ✓</span>}
                    <span>{timeAgo(s.last_updated)}</span>
                  </div>
                </div>
                <div className="score-wrap">
                  <div className="score" style={{ color: s.trend_score > 60 ? "var(--hot)" : "var(--text)" }}>{Math.round(s.trend_score)}</div>
                  <div className="score-label">heat</div>
                </div>
              </Link>
            ))
          )}
        </div>

        <div>
          <div className="card pad" style={{ marginBottom: 16 }}>
            <div className="label" style={{ fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase", color: "var(--text-3)", fontWeight: 600, marginBottom: 12 }}>Live pipeline</div>
            <div style={{ display: "grid", gap: 7, maxHeight: 300, overflow: "auto", fontSize: 12.5 }} className="mono">
              {ingestLog.length === 0 && <span className="dim">No events yet. Run a news cycle or generate an episode.</span>}
              {ingestLog.slice(0, 18).map((l, i) => (
                <div key={i} className="dim" style={{ opacity: 1 - i * 0.045, lineHeight: 1.45 }}>{l}</div>
              ))}
            </div>
          </div>
          <div className="card pad">
            <div style={{ fontSize: 13.5, lineHeight: 1.7 }} className="muted">
              <b style={{ color: "var(--text)" }}>How it works.</b> Every cycle pulls the wires, clusters coverage of the same event across outlets, scores heat from breadth × velocity × recency, then stands ready to turn any story into a fully-voiced podcast episode.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, accent }: { label: string; value: string | number | null | undefined; sub?: string; accent: string }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value" style={{ color: accent }}>{value ?? "—"}</div>
      {sub && <div className="delta up">{sub}</div>}
    </div>
  );
}
