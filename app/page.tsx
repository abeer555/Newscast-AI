"use client";

/**
 * Command Deck.
 *
 * The first thing this page used to say was "1,284 articles / 96 clusters / 12
 * episodes / 41m of audio" — four numbers about the size of a database, none of
 * them about the news. It now opens with the state of the desk: how many stories
 * are moving, how many are corroborated, how many are contested, how many rest on
 * a single outlet. Each of those counts is a filter, so the claim on screen can be
 * checked by clicking it.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, useStore } from "@/lib/store";
import { Explain } from "@/components/Explain";
import { PulseHeader, StoryRow, type ListStory } from "@/components/StoryBits";
import type { NewsPulse, PulseKey } from "@/lib/pulse";

const CATEGORIES = ["all", "politics", "conflict", "technology", "business", "health", "climate", "sports", "science", "general"];

export default function Dashboard() {
  const { refreshStats, pushToast, ingestLog } = useStore((s) => ({
    refreshStats: s.refreshStats,
    pushToast: s.pushToast,
    ingestLog: s.ingestLog,
  }));
  const [stories, setStories] = useState<ListStory[]>([]);
  const [pulse, setPulse] = useState<NewsPulse | null>(null);
  const [loading, setLoading] = useState(true);
  const [ingesting, setIngesting] = useState(false);
  const [category, setCategory] = useState("all");
  const [filter, setFilter] = useState<PulseKey | null>(null);
  const [mode, setMode] = useState<"trending" | "foryou">("trending");

  const load = async () => {
    setLoading(true);
    const qs = new URLSearchParams({ limit: "30", pulse: "1" });
    if (mode === "foryou") qs.set("personalized", "1");
    else qs.set("sort", "trend");
    if (category !== "all") qs.set("category", category);
    if (filter) qs.set("filter", filter);
    const j = await api<{ stories: ListStory[]; pulse?: NewsPulse }>(`/api/stories?${qs}`);
    setStories(j.stories);
    if (j.pulse) setPulse(j.pulse);
    setLoading(false);
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, mode, filter]);

  const ingest = async () => {
    setIngesting(true);
    try {
      await api("/api/ingest", { method: "POST" });
      pushToast("Fresh cycle complete — feeds scanned & stories clustered", "good");
      await load();
      refreshStats();
    } catch (e) {
      pushToast(`Ingest failed: ${e}`, "bad");
    }
    setIngesting(false);
  };

  const activeFacet = pulse?.facets.find((f) => f.key === filter) ?? null;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Command Deck</h1>
          <div className="page-sub">
            Every story clustered across outlets, every claim checked against independent reporting, ready to
            broadcast.
          </div>
        </div>
        <button className={`btn primary ${ingesting ? "loading" : ""}`} onClick={ingest} disabled={ingesting}>
          {ingesting ? "Scanning" : "Run news cycle"}
        </button>
      </div>

      <div style={{ marginBottom: 22 }}>
        <PulseHeader pulse={pulse} active={filter} onPick={setFilter} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 20, alignItems: "start" }}>
        <div className="card">
          <div
            style={{
              display: "flex", alignItems: "center", gap: 10, padding: "14px 18px",
              borderBottom: "1px solid var(--line-soft)", flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", background: "var(--panel-2)", borderRadius: 9, padding: 3 }}>
              {(["trending", "foryou"] as const).map((m) => (
                <button
                  key={m}
                  className="btn sm"
                  onClick={() => setMode(m)}
                  style={{
                    border: "none",
                    background: mode === m ? "var(--panel-3)" : "transparent",
                    color: mode === m ? "var(--accent)" : "var(--text-2)",
                  }}
                >
                  {m === "trending" ? "Trending now" : "For you"}
                </button>
              ))}
            </div>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="btn sm"
              style={{ background: "var(--panel-2)" }}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c[0].toUpperCase() + c.slice(1)}
                </option>
              ))}
            </select>
            {mode === "trending" && (
              <span className="dim" style={{ fontSize: 12 }}>
                ranked by heat
                <Explain title="What this ranking is" label="?" width={330}>
                  <p className="ex-p">
                    Heat = (12 × outlets + 4 × articles) × recency. It measures how much attention a story is
                    getting, so a widely-syndicated wire item can outrank a well-sourced exclusive.
                  </p>
                  <p className="ex-p dim">
                    For how well-established a story is, read the evidence badge on each row instead — that counts
                    independent reporting chains.
                  </p>
                </Explain>
              </span>
            )}
            {activeFacet && (
              <span className="dim" style={{ fontSize: 12, marginLeft: "auto" }}>
                showing <b style={{ color: "var(--accent)" }}>{activeFacet.label.toLowerCase()}</b> only
              </span>
            )}
          </div>

          {loading ? (
            <div style={{ padding: 18, display: "grid", gap: 12 }}>
              {[...Array(6)].map((_, i) => (
                <div key={i} className="skeleton" style={{ height: 54 }} />
              ))}
            </div>
          ) : stories.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center" }} className="muted">
              {activeFacet ? (
                <>
                  No stories match <b>{activeFacet.label.toLowerCase()}</b> in this category.{" "}
                  <button className="btn sm" onClick={() => setFilter(null)} style={{ marginLeft: 8 }}>
                    Clear filter
                  </button>
                </>
              ) : (
                <>
                  No stories yet. Hit <b>Run news cycle</b> to scan the feeds.
                </>
              )}
            </div>
          ) : (
            stories.map((s, i) => <StoryRow key={s.id} story={s} rank={i} />)
          )}
        </div>

        <div>
          <div className="card pad" style={{ marginBottom: 16 }}>
            <div className="section-label">Live pipeline</div>
            <div style={{ display: "grid", gap: 7, maxHeight: 300, overflow: "auto", fontSize: 12.5 }} className="mono">
              {ingestLog.length === 0 && (
                <span className="dim">No events yet. Run a news cycle or generate an episode.</span>
              )}
              {ingestLog.slice(0, 18).map((l, i) => (
                <div key={i} className="dim" style={{ opacity: 1 - i * 0.045, lineHeight: 1.45 }}>
                  {l}
                </div>
              ))}
            </div>
          </div>

          <div className="card pad">
            <div className="section-label">How to read this desk</div>
            <div style={{ fontSize: 13, lineHeight: 1.7 }} className="muted">
              <p style={{ margin: "0 0 9px" }}>
                <b style={{ color: "var(--text)" }}>Heat</b> is attention — outlets × filings × recency. It says
                nothing about whether a story is true.
              </p>
              <p style={{ margin: "0 0 9px" }}>
                <b style={{ color: "var(--text)" }}>Evidence</b> is corroboration — how many independent reporting
                chains carried each claim. Ten papers running one agency dispatch count as one.
              </p>
              <p style={{ margin: 0 }}>
                A story can be hot and thin, or quiet and rock-solid.{" "}
                <Link className="ex-link" href="/methodology">
                  Full methodology
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
