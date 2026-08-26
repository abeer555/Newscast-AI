"use client";

/**
 * Trending.
 *
 * Same stories as the deck, ordered by heat, with the ranking's own bias stated on
 * the page: heat rewards volume and breadth, which is exactly what syndication
 * produces. Each card therefore carries its evidence badge next to its heat score
 * so a loud, thinly-sourced story cannot pass for a well-established one.
 */

import { useEffect, useState } from "react";
import { api, useInterval } from "@/lib/store";
import { Explain } from "@/components/Explain";
import { Time } from "@/components/Time";
import { StoryCard, type ListStory } from "@/components/StoryBits";

type Sort = "trend" | "velocity" | "coverage" | "recent";

const SORTS: { key: Sort; label: string; basis: string }[] = [
  { key: "trend", label: "Heat", basis: "(12 × outlets + 4 × filings) × recency decay. Attention, not importance." },
  { key: "velocity", label: "Filing rate", basis: "Stored articles-per-hour for the cluster. A burst of wire copy ranks highly here." },
  { key: "coverage", label: "Outlets", basis: "Distinct outlets carrying the story, before independence is taken into account." },
  { key: "recent", label: "Latest filing", basis: "Most recently updated cluster first, regardless of how big the story is." },
];

export default function TrendingPage() {
  const [stories, setStories] = useState<ListStory[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<Sort>("trend");
  const [at, setAt] = useState<number | null>(null);

  const load = async () => {
    const j = await api<{ stories: ListStory[] }>(`/api/stories?sort=${sort}&limit=24`);
    setStories(j.stories);
    setAt(Date.now());
    setLoading(false);
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort]);
  useInterval(load, 30_000);

  const max = Math.max(1, ...stories.map((s) => (s.metrics.heat.decayed ? s.metrics.heat.live_score : s.metrics.heat.score)));
  const active = SORTS.find((s) => s.key === sort)!;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Trending</h1>
          <div className="page-sub">
            {active.basis} Refreshes every 30s
            {at !== null && (
              <>
                {" · last "}
                <Time at={at} mode="exact" />
              </>
            )}
            .
          </div>
        </div>
        <div className="filters">
          {SORTS.map((s) => (
            <button key={s.key} className={`fpill ${sort === s.key ? "on" : ""}`} onClick={() => setSort(s.key)} title={s.basis}>
              {s.label}
            </button>
          ))}
          <Explain title="What these orderings reward" label="?" width={360}>
            {SORTS.map((s) => (
              <p className="ex-p" key={s.key}>
                <b>{s.label}</b> — {s.basis}
              </p>
            ))}
            <p className="ex-p dim">
              None of these is a quality ranking. The evidence badge on each card is the corroboration measure; it is
              deliberately shown next to the heat score so the two cannot be confused.
            </p>
          </Explain>
        </div>
      </div>

      {loading ? (
        <div className="grid c2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 170 }} />
          ))}
        </div>
      ) : stories.length === 0 ? (
        <div className="empty">Nothing ingested yet. Run a news cycle from the Command Deck.</div>
      ) : (
        <div className="grid c2" style={{ alignItems: "start" }}>
          {stories.map((s, i) => (
            <StoryCard key={s.id} story={s} rank={i} max={max} />
          ))}
        </div>
      )}
    </div>
  );
}
