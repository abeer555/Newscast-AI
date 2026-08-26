"use client";

/**
 * India Desk.
 *
 * Stories with at least one filing from an Indian outlet. The filters are driven by
 * facet counts computed over the whole India pool, so an option that would lead to
 * an empty list is visibly disabled rather than a dead end, and the page states how
 * membership in this desk is decided instead of leaving it implicit.
 */

import { useEffect, useState } from "react";
import { api, useInterval } from "@/lib/store";
import { Explain } from "@/components/Explain";
import { Time } from "@/components/Time";
import { StoryCard, type ListStory } from "@/components/StoryBits";

type Sort = "trend" | "recent" | "coverage" | "velocity";
type Since = "all" | "hour" | "today" | "week";

const SORTS: { key: Sort; label: string }[] = [
  { key: "trend", label: "Heat" },
  { key: "recent", label: "Latest filing" },
  { key: "coverage", label: "Outlets" },
  { key: "velocity", label: "Filing rate" },
];

interface Facet {
  category: string;
  n: number;
}
interface Window {
  key: string;
  label: string;
  n: number;
}

export default function IndiaPage() {
  const [stories, setStories] = useState<ListStory[]>([]);
  const [facets, setFacets] = useState<Facet[]>([]);
  const [windows, setWindows] = useState<Window[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<Sort>("trend");
  const [category, setCategory] = useState("all");
  const [since, setSince] = useState<Since>("all");
  const [q, setQ] = useState("");
  const [at, setAt] = useState<number | null>(null);

  const load = async () => {
    const qs = new URLSearchParams({ sort, limit: "40" });
    if (category !== "all") qs.set("category", category);
    if (since !== "all") qs.set("since", since);
    if (q.trim()) qs.set("q", q.trim());
    const j = await api<{ stories: ListStory[]; facets: Facet[]; windows: Window[] }>(`/api/stories/india?${qs}`);
    setStories(j.stories);
    setFacets(j.facets ?? []);
    setWindows(j.windows ?? []);
    setAt(Date.now());
    setLoading(false);
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, category, since]);
  useInterval(load, 45_000);

  const max = Math.max(1, ...stories.map((s) => (s.metrics.heat.decayed ? s.metrics.heat.live_score : s.metrics.heat.score)));
  const totalPool = facets.reduce((n, f) => n + f.n, 0);
  const filtered = category !== "all" || since !== "all" || !!q.trim();

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">🇮🇳 India Desk</h1>
          <div className="page-sub">
            {totalPool} {totalPool === 1 ? "story" : "stories"} with at least one filing from an Indian outlet.
            Refreshes every 45s
            {at !== null && (
              <>
                {" · last "}
                <Time at={at} mode="exact" />
              </>
            )}
            .
            <Explain title="How a story lands on this desk" label="?" width={350}>
              <p className="ex-p">
                A cluster appears here when any article in it comes from an outlet on the India list — The Hindu,
                NDTV, ThePrint, Scroll, India Today and others.
              </p>
              <p className="ex-p">
                That means a global story covered by an Indian outlet qualifies. The 🇮🇳 marker on a card confirms
                Indian coverage rather than Indian subject matter, and the desk does not claim otherwise.
              </p>
              <p className="ex-p dim">
                The outlet list is fixed and editor-maintained, not inferred; a missing publication means it has no
                feed configured, not that it was judged unsuitable.
              </p>
            </Explain>
          </div>
        </div>
      </div>

      <div className="card pad" style={{ marginBottom: 18, display: "grid", gap: 12 }}>
        <div className="filters">
          <span className="section-label" style={{ margin: 0, minWidth: 62 }}>
            Order
          </span>
          {SORTS.map((s) => (
            <button key={s.key} className={`fpill ${sort === s.key ? "on" : ""}`} onClick={() => setSort(s.key)}>
              {s.label}
            </button>
          ))}
        </div>

        <div className="filters">
          <span className="section-label" style={{ margin: 0, minWidth: 62 }}>
            Updated
          </span>
          <button className={`fpill ${since === "all" ? "on" : ""}`} onClick={() => setSince("all")}>
            Any time<span className="n">{totalPool}</span>
          </button>
          {windows.map((w) => (
            <button
              key={w.key}
              className={`fpill ${since === w.key ? "on" : ""}`}
              onClick={() => setSince(w.key as Since)}
              disabled={w.n === 0}
              title={w.n === 0 ? "Nothing in this window" : `${w.n} stories`}
            >
              {w.label}
              <span className="n">{w.n}</span>
            </button>
          ))}
        </div>

        <div className="filters">
          <span className="section-label" style={{ margin: 0, minWidth: 62 }}>
            Category
          </span>
          <button className={`fpill ${category === "all" ? "on" : ""}`} onClick={() => setCategory("all")}>
            All<span className="n">{totalPool}</span>
          </button>
          {facets.map((f) => (
            <button
              key={f.category}
              className={`fpill ${category === f.category ? "on" : ""}`}
              onClick={() => setCategory(f.category)}
              disabled={f.n === 0}
            >
              {f.category}
              <span className="n">{f.n}</span>
            </button>
          ))}
        </div>

        <div className="row" style={{ gap: 8 }}>
          <input
            className="input"
            placeholder="Search headlines on this desk…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void load();
            }}
            style={{ maxWidth: 320 }}
          />
          <button className="btn sm" onClick={() => void load()}>
            Search
          </button>
          {filtered && (
            <button
              className="btn sm"
              onClick={() => {
                setCategory("all");
                setSince("all");
                setQ("");
              }}
            >
              Reset filters
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="grid c2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 170 }} />
          ))}
        </div>
      ) : stories.length === 0 ? (
        <div className="card pad" style={{ textAlign: "center", padding: 54 }}>
          <div style={{ fontSize: 38, marginBottom: 12 }}>🗞</div>
          <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 8 }}>
            {filtered ? "Nothing matches these filters" : "No Indian coverage yet"}
          </div>
          <div className="muted" style={{ maxWidth: 460, margin: "0 auto" }}>
            {filtered
              ? "Loosen the window or category — the counts on each button show where there is something to read."
              : "Feeds are still priming. Try the Command Deck while the Indian sources catch up."}
          </div>
        </div>
      ) : (
        <div className="grid c2" style={{ alignItems: "start" }}>
          {stories.map((s, i) => (
            <StoryCard key={s.id} story={s} rank={i} max={max} accent="255,159,67" />
          ))}
        </div>
      )}
    </div>
  );
}
