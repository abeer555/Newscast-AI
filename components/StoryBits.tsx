"use client";

/**
 * Shared story-list pieces.
 *
 * The dashboard, Trending and the India desk all render the same object — a
 * cluster with heat, filing rate, sourcing and claim tiers. They used to render
 * it three different ways, so a story could look well-sourced on one page and
 * bare on another. These components are the single rendering of a story row, and
 * every figure in them is inspectable.
 */

import Link from "next/link";
import { Explain, Breakdown, Metric } from "./Explain";
import { EvidenceBadge, SourceCount } from "./Evidence";
import { Time } from "./Time";
import type { StoryMetrics } from "@/lib/enrich";
import type { NewsPulse, PulseKey } from "@/lib/pulse";

/* ------------------------------------------------------------------ *
 * Types the list endpoints return
 * ------------------------------------------------------------------ */

export interface StoryEvidence {
  claims: number;
  confirmed: number;
  corroborated: number;
  reported: number;
  disputed: number;
  verified: boolean;
  best_tier: "confirmed" | "corroborated" | "reported" | "disputed" | "none";
}

export interface ListStory {
  id: string;
  title: string;
  category: string;
  trend_score: number;
  velocity: number;
  article_count: number;
  source_count: number;
  sources: string[];
  first_seen: number;
  last_updated: number;
  has_intel?: boolean;
  topics?: string[];
  summary?: string | null;
  image_url?: string | null;
  metrics: StoryMetrics;
  evidence?: StoryEvidence;
  developing?: boolean;
  breaking?: boolean;
  india_origin?: boolean;
}

/* ------------------------------------------------------------------ *
 * The pulse header — what is happening, not how much we have stored
 * ------------------------------------------------------------------ */

export function PulseHeader({
  pulse,
  active,
  onPick,
}: {
  pulse: NewsPulse | null;
  active: PulseKey | null;
  onPick: (k: PulseKey | null) => void;
}) {
  if (!pulse) return <div className="skeleton" style={{ height: 148, borderRadius: 16 }} />;

  return (
    <div className="pulse">
      <div>
        <div className="pulse-lead">
          <b>{pulse.headline}</b>
          {pulse.clusters > 0 && <> — {pulse.sub}</>}
        </div>
        <div className="pulse-note" style={{ marginTop: 6 }}>
          Across the {pulse.window_label}, as of <Time at={pulse.as_of} mode="exact" />
          <Explain title="How the pulse is counted" label="?" width={360}>
            <p className="ex-p">{pulse.method}</p>
            {pulse.facets.map((f) => (
              <p className="ex-p" key={f.key}>
                <b>
                  {f.label} ({f.count})
                </b>{" "}
                — {f.detail}
              </p>
            ))}
          </Explain>
        </div>
      </div>

      <div className="filters">
        {pulse.facets.map((f) => (
          <button
            key={f.key}
            className={`fpill ${active === f.key ? "on" : ""}`}
            onClick={() => onPick(active === f.key ? null : f.key)}
            disabled={f.count === 0}
            title={f.detail}
          >
            {f.label}
            <span className="n">{f.count}</span>
          </button>
        ))}
        {active && (
          <button className="fpill" onClick={() => onPick(null)}>
            Clear filter
          </button>
        )}
      </div>

      {pulse.top_categories.length > 1 && (
        <div className="pulse-note">
          Heaviest coverage:{" "}
          {pulse.top_categories.map((c, i) => (
            <span key={c.category}>
              {i > 0 && " · "}
              <b style={{ color: "var(--text-2)" }}>{c.category}</b> {c.clusters}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Per-story figures
 * ------------------------------------------------------------------ */

/** Heat, with the arithmetic behind it one click away. */
export function HeatFigure({ metrics, rank }: { metrics: StoryMetrics; rank?: number }) {
  const h = metrics.heat;
  const shown = h.decayed ? h.live_score : h.score;
  return (
    <div className="score-wrap">
      <div className="score" style={{ color: rank !== undefined && rank < 3 ? "var(--hot)" : "var(--text)" }}>
        {Math.round(shown)}
      </div>
      <div className="score-label">
        heat
        <Explain title="How heat is calculated" label="?" width={340}>
          <Breakdown
            components={h.components}
            formula={h.formula}
            result={h.score}
            resultLabel="Score when last clustered"
          />
          {h.decayed && (
            <p className="ex-p warn">
              Shown as <b>{h.live_score}</b> — recency decay since it was scored. The stored ranking value is{" "}
              {h.score}.
            </p>
          )}
          <p className="ex-p dim">Heat measures attention, not importance and not reliability.</p>
        </Explain>
      </div>
    </div>
  );
}

/** Filing rate, with its unit and period spelled out. */
export function RateChip({ metrics }: { metrics: StoryMetrics }) {
  const v = metrics.velocity;
  const shown = v.recent ?? v.lifetime;
  const arrow = v.trend === "rising" ? "▲" : v.trend === "cooling" ? "▼" : "▬";
  return (
    <span className={`chip ${v.trend === "rising" ? "trend" : ""}`}>
      {arrow} {shown}/h
      <Explain title="Filing rate" label="?" width={330}>
        <p className="ex-p">{v.definition}</p>
        <p className="ex-p">
          <b>Lifetime:</b> {v.articles_total} articles over {v.age_hours}h = {v.lifetime} articles/hour
        </p>
        {v.recent !== null && (
          <p className="ex-p">
            <b>Last 24h:</b> {v.articles_24h} articles = {v.recent} articles/hour ({v.trend})
          </p>
        )}
        <p className="ex-p dim">
          The figure on the card is the trailing-24h rate when available, otherwise the lifetime average. It is
          articles per hour — not mentions, views or a normalised index.
        </p>
      </Explain>
    </span>
  );
}

/** Claim tiers rolled up to one honest chip. */
export function EvidenceMini({ evidence }: { evidence: StoryEvidence | undefined }) {
  if (!evidence || !evidence.verified) {
    return (
      <span className="chip prov prov-dim">
        not checked
        <Explain title="No evidence layer yet" label="?" width={320}>
          <p className="ex-p">
            No claim in this story has been extracted or cross-checked. Open it and run intelligence — verification
            happens in the same pass, with no podcast required.
          </p>
        </Explain>
      </span>
    );
  }
  if (evidence.claims === 0) {
    // The evidence layer ran and found nothing to extract. Falling through to the
    // single-chain branch below produced "All 0 extracted claims rest on one
    // reporting chain", which is both nonsense and reassuring in the wrong direction.
    return (
      <span className="chip prov prov-dim">
        no claims extracted
        <Explain title="Checked, nothing extractable" label="?" width={340}>
          <p className="ex-p">
            The evidence layer ran on this story but pulled out no checkable factual claims. That usually means the
            coverage so far is comment, analysis or a headline with no body text yet.
          </p>
          <p className="ex-p dim">
            Nothing here is verified or falsified — there is simply nothing to cross-check. Re-verify once more
            reporting lands.
          </p>
        </Explain>
      </span>
    );
  }
  if (evidence.disputed > 0) {
    return (
      <span className="chip prov prov-warm" style={{ color: "var(--bad)", borderColor: "rgba(255,107,107,0.36)" }}>
        {evidence.disputed} conflicting {evidence.disputed === 1 ? "claim" : "claims"}
        <Explain title="Sources conflict" label="?" width={330}>
          <p className="ex-p">
            {evidence.disputed} {evidence.disputed === 1 ? "claim in this story is" : "claims in this story are"}{" "}
            reported incompatibly by different outlets. Both accounts are shown side by side in the story&apos;s
            evidence tab rather than one being picked.
          </p>
        </Explain>
      </span>
    );
  }
  if (evidence.confirmed > 0) {
    return (
      <span className="chip prov prov-good">
        {evidence.confirmed} confirmed
        <Explain title="Confirmed claims" label="?" width={330}>
          <p className="ex-p">
            {evidence.confirmed} of {evidence.claims} extracted claims were carried by three or more independent
            reporting chains.
          </p>
          <p className="ex-p dim">Chains, not outlets — ten papers running one agency dispatch count once.</p>
        </Explain>
      </span>
    );
  }
  if (evidence.corroborated > 0) {
    return (
      <span className="chip prov prov-info">
        {evidence.corroborated} corroborated
        <Explain title="Corroborated claims" label="?" width={320}>
          <p className="ex-p">
            {evidence.corroborated} of {evidence.claims} claims were carried by two independent reporting chains.
            Nothing here has reached three yet.
          </p>
        </Explain>
      </span>
    );
  }
  return (
    <span className="chip prov prov-warm">
      single-chain claims
      <Explain title="One reporting chain" label="?" width={330}>
        <p className="ex-p">
          All {evidence.claims} extracted {evidence.claims === 1 ? "claim rests" : "claims rest"} on one reporting
          chain. Treat as a single-source account until another newsroom confirms it.
        </p>
      </Explain>
    </span>
  );
}

/** Which outlets, and how many of them are actually independent. */
export function SourceDiversity({ story, max = 4 }: { story: ListStory; max?: number }) {
  const ind = story.metrics.independence;
  return (
    <div className="row" style={{ gap: 6 }}>
      <span className="chip src">
        <SourceCount outlets={ind.outlets || story.source_count} independent={ind.independent} />
        <Explain title="Outlets vs independent chains" label="?" width={340}>
          <p className="ex-p">{story.metrics.evidence.note}</p>
          {ind.chains.map((c) => (
            <p className="ex-p" key={c.label}>
              <b>{c.label}</b> <span className="dim">({c.kind === "agency" ? "wire agency" : "newsroom"})</span> —{" "}
              {c.outlets.join(", ")}
            </p>
          ))}
          {story.metrics.evidence.caveat && <p className="ex-p warn">{story.metrics.evidence.caveat}</p>}
        </Explain>
      </span>
      {story.sources.slice(0, max).map((s) => (
        <span key={s} className="chip" style={{ fontSize: 10.5 }}>
          {s}
        </span>
      ))}
      {story.sources.length > max && (
        <span className="dim" style={{ fontSize: 11.5 }}>
          +{story.sources.length - max}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The two list layouts
 *
 * Both are plain containers with the headline as the link, rather than a link
 * wrapping the whole row. The figures inside carry "why?" popovers, and a button
 * nested inside an anchor is both invalid markup and a trap for the reader — the
 * click would fight the navigation.
 * ------------------------------------------------------------------ */

/** Compact row for the dashboard's ranked list. */
export function StoryRow({ story, rank }: { story: ListStory; rank: number }) {
  return (
    <div className="story-row">
      <div className={`rank ${rank < 3 ? "hot" : ""}`}>{rank + 1}</div>
      <div style={{ minWidth: 0 }}>
        <div className="story-title">
          {story.breaking && (
            <span className="chip trend" style={{ marginRight: 7, fontSize: 10 }}>
              NEW
            </span>
          )}
          <Link href={`/story/${story.id}`}>{story.title}</Link>
        </div>
        <div className="story-meta">
          <span className="chip cat">{story.category}</span>
          <EvidenceBadge evidence={story.metrics.evidence} compact />
          <EvidenceMini evidence={story.evidence} />
          <RateChip metrics={story.metrics} />
          <Time at={story.last_updated} mode="both" />
        </div>
      </div>
      <HeatFigure metrics={story.metrics} rank={rank} />
    </div>
  );
}

/** Roomier card for Trending and the India desk. */
export function StoryCard({
  story,
  rank,
  max,
  accent = "255,91,127",
}: {
  story: ListStory;
  rank: number;
  max: number;
  accent?: string;
}) {
  const shown = story.metrics.heat.decayed ? story.metrics.heat.live_score : story.metrics.heat.score;
  const frac = Math.max(0, Math.min(1, shown / Math.max(1, max)));
  return (
    <div className="card pad" style={{ position: "relative", overflow: "hidden" }}>
      <div
        aria-hidden
        style={{
          position: "absolute", left: 0, top: 0, bottom: 0, width: `${frac * 100}%`,
          background: `linear-gradient(90deg, rgba(${accent},${0.1 + 0.1 * frac}), transparent)`,
          pointerEvents: "none",
        }}
      />
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start", position: "relative" }}>
        <div className={`rank ${rank < 3 ? "hot" : ""}`} style={{ fontSize: 26, minWidth: 34 }}>
          {rank + 1}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 650, fontSize: 15, lineHeight: 1.4, marginBottom: 9, display: "flex", gap: 8, alignItems: "flex-start" }}>
            <Link href={`/story/${story.id}`} style={{ flex: 1 }}>
              {story.title}
            </Link>
            {story.india_origin && (
              <span className="chip" style={{ flexShrink: 0, fontSize: 10.5, background: "rgba(255,159,67,0.15)", color: "var(--accent-2)" }}>
                🇮🇳
              </span>
            )}
          </div>
          <div className="row" style={{ gap: 6, marginBottom: 9 }}>
            <span className="chip cat">{story.category}</span>
            <EvidenceBadge evidence={story.metrics.evidence} compact />
            <EvidenceMini evidence={story.evidence} />
            <RateChip metrics={story.metrics} />
            <span className="chip">{story.article_count} filings</span>
          </div>
          <SourceDiversity story={story} />
          {story.summary && (
            <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.55, margin: "9px 0 0" }}>
              {story.summary.slice(0, 150)}
              {story.summary.length > 150 ? "…" : ""}
            </p>
          )}
          <div className="dim" style={{ fontSize: 11.5, marginTop: 8 }}>
            First filing <Time at={story.first_seen} mode="exact" /> · latest <Time at={story.last_updated} mode="both" />
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <Metric
            label="heat"
            value={Math.round(shown)}
            strong
            explainTitle="How heat is calculated"
            explain={
              <>
                <Breakdown
                  components={story.metrics.heat.components}
                  formula={story.metrics.heat.formula}
                  result={story.metrics.heat.score}
                  resultLabel="Score when last clustered"
                />
                {story.metrics.heat.decayed && (
                  <p className="ex-p warn">
                    Decayed to <b>{story.metrics.heat.live_score}</b> since scoring.
                  </p>
                )}
                <p className="ex-p dim">Attention, not importance and not reliability.</p>
              </>
            }
          />
          <Link href={`/story/${story.id}`} className="btn sm" style={{ marginTop: 10, fontSize: 12 }}>
            Open →
          </Link>
        </div>
      </div>
    </div>
  );
}
