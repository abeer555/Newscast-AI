"use client";

/**
 * Story page — the trust centre.
 *
 * The old version of this page presented a model's summary as fact and buried
 * verification behind "generate a podcast first". It now answers, in order: what
 * is claimed, how well each claim is sourced, who moved the story forward, and
 * what nobody knows yet. Every number is clickable and explains itself.
 *
 * Two endpoints feed it. `/api/stories/[id]` carries the cluster, its articles
 * and the derived metrics; `/api/stories/[id]/evidence` carries the claim tiers,
 * contradictions, coverage comparison and the sentence-level citations for the
 * narrative. The evidence layer runs with the intelligence pass, so this page is
 * never empty for a story that has been analysed.
 */

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, useStore, useInterval } from "@/lib/store";
import { Breakdown, Explain, Metric } from "@/components/Explain";
import { Time, exactTime } from "@/components/Time";
import {
  EvidenceBadge,
  ForecastChip,
  LeanChip,
  OriginalityChip,
  Panel,
  SourceCount,
  TierBadge,
  TIER_TEXT,
  forecastLevelOf,
} from "@/components/Evidence";
import GenerateModal from "@/components/GenerateModal";
import type { EvidenceStrength, HeatBreakdown, ScoreBand, ScoreComponent, VelocityStats } from "@/lib/scoring";
import type { Originality } from "@/lib/independence";
import type { ClaimTier } from "@/lib/verification";

/* ------------------------------------------------------------------ *
 * Payload shapes
 * ------------------------------------------------------------------ */

interface Article {
  id: string;
  title: string;
  summary: string;
  url: string;
  author: string | null;
  published_at: number;
  image_url: string | null;
  source_id: string;
  source_name: string;
  lean: string;
  country: string;
  similarity: number;
}

interface Intel {
  headline: string;
  lede: string;
  summary_long: string;
  category: string;
  importance: number;
  sentiment: number;
  key_facts: { fact: string; confidence: string }[];
  entities: { name: string; type: string }[];
  why_it_matters: string;
  what_next: string;
  framing: { source: string; lean: string; headline: string; framing: string; emphasis: string[]; tone: string; omits: string }[];
  consensus: string[];
  disagreements: string[];
  timeline: { time: string; event: string }[];
  podcast_angle: string;
}

interface EpisodeLite {
  id: string;
  title: string;
  status: string;
  language: string;
  format: string;
  audio_duration: number | null;
  created_at: number;
}

interface StoryMetricsView {
  heat: HeatBreakdown;
  velocity: VelocityStats;
  evidence: EvidenceStrength;
  independence: {
    outlets: number;
    independent: number;
    attributed: number;
    syndicated_copies: number;
    chains: { label: string; kind: "newsroom" | "agency"; outlets: string[] }[];
    broke_first: { source_name: string; published_at: number; chain_label: string } | null;
  };
}

interface Story {
  id: string;
  title: string;
  category: string;
  trend_score: number;
  velocity: number;
  first_seen: number;
  last_updated: number;
  intelligence: Intel | null;
  articles: Article[];
  episodes: EpisodeLite[];
  topics: string[];
  metrics: StoryMetricsView;
  score_explain: {
    importance: ScoreBand & { method: string };
    sentiment: ScoreBand & { method: string; scaled: number; raw: number };
  } | null;
  verification: { status: string; verified_at: number | null; fact_count: number };
}

interface AttestationView {
  article_id: string;
  source: string;
  source_id: string;
  url: string;
  published_at: number;
  chain: string;
  chain_label: string;
  originality: Originality;
  text: string;
}

interface FactView {
  id: string;
  claim: string;
  tier: ClaimTier;
  tier_label: string;
  tier_reason: string;
  status: string;
  confidence: number;
  support_count: number;
  outlet_count: number;
  independent_count: number;
  outlets: string[];
  chains: string[];
  origins: string[];
  variants: string[];
  attestations: AttestationView[];
  contradicted_by: string[];
  topic: string | null;
  first_reported_by: string | null;
  first_reported_at: number | null;
  first_seen: number;
  last_seen: number;
}

interface OutletCoverageView {
  article_id: string;
  source_id: string;
  source: string;
  lean: string;
  url: string;
  title: string;
  published_at: number;
  lag_ms: number;
  lag_label: string;
  originality: Originality;
  originality_label: string;
  chain: string;
  chain_label: string;
  basis: string;
  angle: string | null;
  emphasis: string[];
  coverage_gap: string | null;
  tone: string | null;
  claims_carried: number;
  unique_claims: number;
  unique_examples: string[];
  overlap_pct: number;
  added_first: number;
  body_chars: number;
}

interface CoverageView {
  outlets: OutletCoverageView[];
  waves: { kind: "incident" | "first_report" | "follow_up"; label: string; at: number; delta_label: string | null; source: string | null; detail: string; url?: string | null }[];
  broke_first: { source: string; at: number; lead_label: string | null; chain_label: string } | null;
  independence: StoryMetricsView["independence"] & { summary: string };
  evidence: EvidenceStrength;
  followers: string[];
  movers: string[];
  gaps: string[];
  spread_label: string;
  method: string;
}

interface CitationView {
  claim_id: string;
  claim: string;
  tier: ClaimTier;
  outlets: string[];
  independent_count: number;
  match: number;
}

interface CitedTextView {
  sentences: { text: string; citations: CitationView[]; tier: ClaimTier | null; outlets: string[]; independent: number }[];
  cited: number;
  total: number;
  coverage_pct: number;
  note: string;
}

interface Evidence {
  facts: FactView[];
  tier_counts: Record<string, number>;
  contradictions: { fact_id: string; claim: string; claim_sources: string[]; against: ({ fact_id: string; claim: string; sources: string[] } | null)[] }[];
  coverage: CoverageView;
  metrics: StoryMetricsView;
  narrative: { story: CitedTextView; why: CitedTextView; lede: CitedTextView; next: string[]; threshold: number };
  known: { solid: string[]; contested: string[]; unknown: string[]; consensus: string[]; disagreements: string[]; updated_at: number | null };
  living_story: { current_summary: string; current_summary_at: number; version: number; timeline: { t: string; event: string; source_ids: string[] }[]; last_fused_at: number } | null;
  verification: { status: string; verified_at: number | null; fact_count: number; tiers: Record<string, number> };
  methods: { confidence: string; independence: string; tiers: Record<string, string>; coverage: string };
  episodes: { id: string; title: string; status: string }[];
}

const TONE_EMOJI: Record<string, string> = {
  alarmed: "🚨", neutral: "📰", optimistic: "🌤", critical: "🔍", celebratory: "🎉", cautious: "🧭",
};

type Tab = "story" | "dossier" | "coverage" | "timeline" | "sources";

/* ------------------------------------------------------------------ *
 * Page
 * ------------------------------------------------------------------ */

export default function StoryPage() {
  const { id } = useParams<{ id: string }>();
  const pushToast = useStore((s) => s.pushToast);
  const [story, setStory] = useState<Story | null>(null);
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("story");

  const load = async () => {
    setStory(await api<Story>(`/api/stories/${id}`));
    try {
      setEvidence(await api<Evidence>(`/api/stories/${id}/evidence`));
    } catch {
      /* evidence layer is additive — the page still renders without it */
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const analyze = async (force = false) => {
    setAnalyzing(true);
    try {
      await api(`/api/stories/${id}`, { method: "POST", body: JSON.stringify({ analyze: true, force }) });
      await load();
      pushToast("Dossier ready — claims extracted and cross-checked", "good");
    } catch (e) {
      pushToast(`Analysis failed: ${e}`, "bad");
    }
    setAnalyzing(false);
  };

  const reverify = async () => {
    setVerifying(true);
    try {
      await api(`/api/stories/${id}`, { method: "POST", body: JSON.stringify({ verify: true, force: true }) });
      await load();
      pushToast("Evidence layer re-checked against the latest articles", "good");
    } catch (e) {
      pushToast(`Verification failed: ${e}`, "bad");
    }
    setVerifying(false);
  };

  if (!story) {
    return (
      <div style={{ padding: 40 }}>
        <div className="skeleton" style={{ height: 300 }} />
      </div>
    );
  }

  const intel = story.intelligence;
  const cov = evidence?.coverage ?? null;
  const facts = evidence?.facts ?? [];

  const TABS: { key: Tab; label: string; n?: number }[] = [
    { key: "story", label: "The story" },
    { key: "dossier", label: "Evidence", n: facts.length },
    { key: "coverage", label: "Coverage", n: story.articles.length },
    { key: "timeline", label: "Timeline", n: cov?.waves.length },
    { key: "sources", label: "Sources", n: story.metrics.independence.outlets },
  ];

  return (
    <div>
      <Link href="/" className="dim" style={{ fontSize: 13 }}>
        ← Command Deck
      </Link>

      <StoryHeader
        story={story}
        intel={intel}
        analyzing={analyzing}
        verifying={verifying}
        onAnalyze={() => analyze(!!intel)}
        onVerify={reverify}
        onProduce={() => (intel ? setGenOpen(true) : pushToast("Run intelligence first — the script is written from the dossier", "info"))}
      />

      {story.episodes.length > 0 && (
        <div className="card pad" style={{ marginBottom: 18 }}>
          <div className="section-label">Episodes from this story</div>
          <div style={{ display: "grid", gap: 8 }}>
            {story.episodes.map((e) => (
              <EpisodeStrip key={e.id} episodeId={e.id} initialEpisode={e} />
            ))}
          </div>
        </div>
      )}

      {!intel ? (
        <NoIntelligence story={story} analyzing={analyzing} onAnalyze={() => analyze(false)} />
      ) : (
        <>
          <div className="tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                className={`tab ${tab === t.key ? "on" : ""}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
                {typeof t.n === "number" && t.n > 0 && <span className="n">{t.n}</span>}
              </button>
            ))}
          </div>

          {tab === "story" && <StoryTab intel={intel} story={story} evidence={evidence} />}
          {tab === "dossier" && <DossierTab evidence={evidence} verifying={verifying} onVerify={reverify} />}
          {tab === "coverage" && <CoverageTab intel={intel} coverage={cov} />}
          {tab === "timeline" && <TimelineTab intel={intel} coverage={cov} living={evidence?.living_story ?? null} />}
          {tab === "sources" && <SourcesTab story={story} coverage={cov} />}
        </>
      )}

      {genOpen && (
        <GenerateModal
          clusterId={story.id}
          onClose={() => setGenOpen(false)}
          onGo={() => {
            void load();
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Header — the numbers, each one inspectable
 * ------------------------------------------------------------------ */

function StoryHeader({
  story,
  intel,
  analyzing,
  verifying,
  onAnalyze,
  onVerify,
  onProduce,
}: {
  story: Story;
  intel: Intel | null;
  analyzing: boolean;
  verifying: boolean;
  onAnalyze: () => void;
  onVerify: () => void;
  onProduce: () => void;
}) {
  const m = story.metrics;
  const v = m.velocity;
  const se = story.score_explain;

  return (
    <>
      <div className="page-head" style={{ marginTop: 10, alignItems: "flex-start" }}>
        <div style={{ maxWidth: 830 }}>
          <div className="row" style={{ marginBottom: 11, gap: 8 }}>
            <span className="chip cat">{intel?.category ?? story.category}</span>
            <EvidenceBadge evidence={m.evidence} />
            <span className="chip">
              {story.articles.length} {story.articles.length === 1 ? "article" : "articles"}
            </span>
          </div>
          <h1 className="page-title" style={{ fontSize: 27 }}>
            {intel?.headline ?? story.title}
          </h1>
          {intel && (
            <div className="page-sub" style={{ fontSize: 15, lineHeight: 1.55 }}>
              {intel.lede}
            </div>
          )}
          <div className="dim" style={{ fontSize: 12, marginTop: 9 }}>
            First filing <Time at={story.first_seen} mode="exact" /> · latest <Time at={story.last_updated} mode="both" />
          </div>
        </div>
        <div className="row" style={{ gap: 10, flexShrink: 0, alignItems: "flex-start" }}>
          <button className="btn" onClick={onAnalyze} disabled={analyzing}>
            {analyzing ? "Analysing…" : intel ? "Re-analyse" : "Run intelligence"}
          </button>
          <button className="btn primary" onClick={onProduce}>
            ✦ Produce podcast
          </button>
        </div>
      </div>

      <div className="card pad" style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", gap: 30, flexWrap: "wrap", alignItems: "flex-start" }}>
          <Metric
            label="Heat"
            value={m.heat.decayed ? m.heat.live_score : m.heat.score}
            strong
            sub={m.heat.decayed ? `${m.heat.score} when scored ${relDays(m.heat.scored_at)}` : "coverage intensity"}
            explainTitle="How heat is calculated"
            explain={
              <>
                <Breakdown
                  components={m.heat.components as ScoreComponent[]}
                  formula={m.heat.formula}
                  result={m.heat.score}
                  resultLabel={`Score at ${exactTime(m.heat.scored_at)}`}
                />
                {m.heat.decayed && (
                  <p className="ex-p warn">
                    Decayed to <b>{m.heat.live_score}</b> since — the story is now {Math.round(m.heat.live_age_hours)}h
                    old and recency multiplies to ×{(m.heat.live_score / Math.max(1, m.heat.subtotal)).toFixed(2)}.
                  </p>
                )}
                <p className="ex-p dim">
                  Heat measures attention, not importance or reliability.{" "}
                  <Link className="ex-link" href="/methodology#heat">
                    Methodology
                  </Link>
                </p>
              </>
            }
          />

          <Metric
            label="Filing rate"
            value={`${v.lifetime} ${v.unit}`}
            sub={v.recent !== null ? `${v.recent}/h over the last 24h · ${v.trend}` : `${v.articles_total} filings in ${Math.round(v.age_hours)}h`}
            explainTitle="What this rate measures"
            explain={
              <>
                <p className="ex-p">{v.definition}</p>
                <p className="ex-p">
                  <b>Lifetime:</b> {v.articles_total} articles ÷ {v.age_hours}h = {v.lifetime}/h
                </p>
                {v.articles_24h !== null && (
                  <p className="ex-p">
                    <b>Last 24h:</b> {v.articles_24h} articles → {v.recent}/h ({v.trend})
                  </p>
                )}
                <p className="ex-p dim">
                  Not social mentions, not page views, not a normalised index.{" "}
                  <Link className="ex-link" href="/methodology#velocity">
                    Methodology
                  </Link>
                </p>
              </>
            }
          />

          <Metric
            label="Sourcing"
            value={<SourceCount outlets={m.independence.outlets} independent={m.independence.independent} />}
            sub={m.evidence.caveat ? "independence may be overstated" : m.evidence.note.split(".")[0]}
            explainTitle="Independent reporting chains"
            explain={
              <>
                <p className="ex-p">{m.evidence.note}</p>
                {m.independence.chains.map((c) => (
                  <p className="ex-p" key={c.label}>
                    <b>{c.label}</b> <span className="dim">({c.kind})</span> — {c.outlets.join(", ")}
                  </p>
                ))}
                {m.evidence.caveat && <p className="ex-p warn">{m.evidence.caveat}</p>}
                <p className="ex-p dim">
                  <Link className="ex-link" href="/methodology#independence">
                    How chains are identified
                  </Link>
                </p>
              </>
            }
          />

          {intel && se && (
            <>
              <Metric
                label="Importance"
                value={`${intel.importance} · ${se.importance.band}`}
                sub="model judgement"
                explainTitle="Importance is a model judgement"
                explain={
                  <>
                    <p className="ex-p">
                      <b>{se.importance.band}</b> — {se.importance.meaning}
                    </p>
                    <p className="ex-p">{se.importance.method}</p>
                    <p className="ex-p dim">
                      No formula produced this. Two runs on the same articles can differ by a few points, so it is
                      useful for ranking and not for citation.{" "}
                      <Link className="ex-link" href="/methodology#importance">
                        Methodology
                      </Link>
                    </p>
                  </>
                }
              />
              <Metric
                label="Coverage tone"
                value={se.sentiment.band}
                sub={`${se.sentiment.scaled}/100 · 50 is neutral`}
                explainTitle="What tone measures"
                explain={
                  <>
                    <p className="ex-p">
                      <b>{se.sentiment.band}</b> — {se.sentiment.meaning}
                    </p>
                    <p className="ex-p">{se.sentiment.method}</p>
                    <p className="ex-p dim">
                      This describes how outlets are framing the event. It is not a judgement about whether the event
                      is good or bad.
                    </p>
                  </>
                }
              />
            </>
          )}
        </div>

        <div className="hr" />
        <VerificationBar verification={story.verification} verifying={verifying} onVerify={onVerify} />
      </div>
    </>
  );
}

function VerificationBar({
  verification,
  verifying,
  onVerify,
}: {
  verification: Story["verification"];
  verifying: boolean;
  onVerify: () => void;
}) {
  const { status, verified_at, fact_count } = verification;
  const tone = status === "done" ? "good" : status === "failed" ? "bad" : status === "running" ? "warm" : "dim";
  const label =
    status === "done"
      ? `${fact_count} ${fact_count === 1 ? "claim" : "claims"} extracted and cross-checked`
      : status === "running"
        ? "Verification in progress"
        : status === "failed"
          ? "Verification failed on the last run"
          : fact_count > 0
            ? `${fact_count} claims on record from an earlier run`
            : "Not verified yet";

  return (
    <div className="row" style={{ justifyContent: "space-between" }}>
      <div className="row" style={{ gap: 10 }}>
        <span className={`tier tier-${tone}`}>
          <span className="tier-dot" aria-hidden>
            {status === "done" ? "🟢" : status === "failed" ? "🔴" : status === "running" ? "🟠" : "⚪"}
          </span>
          <span className="tier-label">Evidence layer</span>
        </span>
        <span className="dim" style={{ fontSize: 12.5 }}>
          {label}
          {verified_at ? (
            <>
              {" · "}
              <Time at={verified_at} mode="both" />
            </>
          ) : null}
        </span>
      </div>
      {/* The Explain popover is itself a button, so it sits beside the action rather
          than inside it — a button inside a button is invalid HTML and breaks hydration. */}
      <span className="row" style={{ gap: 6, alignItems: "center" }}>
        <button className="btn sm" onClick={onVerify} disabled={verifying}>
          {verifying ? "Re-checking…" : "Re-verify"}
        </button>
        <Explain title="What re-verify does" label="?" width={330}>
          <p className="ex-p">
            Re-extracts claims from every article in this story, regroups them, recounts independent reporting chains
            and re-runs contradiction detection. Use it after new articles arrive.
          </p>
          <p className="ex-p dim">
            Verification also runs automatically with the intelligence pass — you never have to produce a podcast to
            check a claim.
          </p>
        </Explain>
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Tab 1 — the story, with its sourcing shown inline
 * ------------------------------------------------------------------ */

function StoryTab({ intel, story, evidence }: { intel: Intel; story: Story; evidence: Evidence | null }) {
  const narrative = evidence?.narrative ?? null;
  const known = evidence?.known ?? null;
  const topFacts = (evidence?.facts ?? []).slice(0, 7);

  const nextLines = useMemo(() => {
    const lines = narrative?.next?.length ? narrative.next : intel.what_next ? [intel.what_next] : [];
    return lines.map((l) => ({ text: l, level: forecastLevelOf(l) }));
  }, [narrative?.next, intel.what_next]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.62fr 1fr", gap: 20, alignItems: "start" }}>
      <div className="grid">
        <Panel
          title="The story"
          sub={
            narrative
              ? `${narrative.story.cited} of ${narrative.story.total} sentences are backed by a verified claim`
              : "Narrative written from the article set"
          }
          right={
            narrative && (
              <Explain title="How citations work here" label="Citations" tone="link" width={350}>
                <p className="ex-p">{narrative.story.note}</p>
                <p className="ex-p">
                  A sentence is cited when at least {Math.round(narrative.threshold * 100)}% of a verified claim&apos;s
                  content words and entities appear in it. Click a marker to see which outlets carried that claim.
                </p>
                <p className="ex-p dim">
                  Underlined in green: backed. Underlined in grey: the evidence layer does not support it — usually
                  context or connective phrasing.
                </p>
              </Explain>
            )
          }
        >
          {narrative && narrative.story.total > 0 ? (
            <CitedProse text={narrative.story} />
          ) : (
            <p style={{ lineHeight: 1.7, margin: 0 }}>{intel.summary_long}</p>
          )}
        </Panel>

        <Panel
          title="What is actually established"
          sub={
            topFacts.length
              ? "Claims from the evidence layer, strongest sourcing first"
              : "Model-extracted key points — no verified claims on record yet"
          }
        >
          {topFacts.length > 0 ? (
            <div>
              {topFacts.map((f) => (
                <div className="claim" key={f.id}>
                  <div className="claim-text">{f.claim}</div>
                  <div className="claim-meta">
                    <TierBadge tier={f.tier} reason={f.tier_reason} outlets={f.outlets} chains={f.chains} compact />
                    {f.outlets.slice(0, 4).map((o) => (
                      <span className="claim-cite" key={o}>
                        {o}
                      </span>
                    ))}
                    {f.outlets.length > 4 && <span className="dim">+{f.outlets.length - 4} more</span>}
                  </div>
                </div>
              ))}
              {(evidence?.facts.length ?? 0) > topFacts.length && (
                <p className="dim" style={{ fontSize: 12.5, marginTop: 12, marginBottom: 0 }}>
                  {(evidence?.facts.length ?? 0) - topFacts.length} further claims are in the Evidence tab.
                </p>
              )}
            </div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {(intel.key_facts ?? []).map((f, i) => (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <span
                    style={{
                      width: 8, height: 8, borderRadius: "50%", marginTop: 6, flexShrink: 0,
                      background: f.confidence === "confirmed" ? "var(--good)" : f.confidence === "reported" ? "var(--warm)" : "var(--bad)",
                    }}
                  />
                  <div>
                    <div style={{ fontSize: 14, lineHeight: 1.5 }}>{f.fact}</div>
                    <div className="dim" style={{ fontSize: 11 }}>
                      Model-assigned label ({f.confidence}) — not a source count. Run Re-verify for real tiers.
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <div className="grid c2">
          <Panel title="Why it matters">
            {narrative && narrative.why.total > 0 ? (
              <CitedProse text={narrative.why} small />
            ) : (
              <div style={{ fontSize: 14, lineHeight: 1.6 }}>{intel.why_it_matters}</div>
            )}
          </Panel>
          <Panel
            title="What happens next"
            sub="Each line labelled by how firm it is"
            right={
              <Explain title="These are not predictions" label="?" width={330}>
                <p className="ex-p">
                  Labels are read from the language in the coverage: a scheduled hearing is <b>Likely</b>, a stated
                  intention is <b>Expected</b>, a raised possibility is <b>Possible</b>, and an absence of any
                  indication is <b>Unknown</b>.
                </p>
                <p className="ex-p dim">No forecasting model is involved. Nothing here is a prediction.</p>
              </Explain>
            }
          >
            <div className="stack">
              {nextLines.length === 0 && <div className="kud-empty">The coverage says nothing about what comes next.</div>}
              {nextLines.map((l, i) => (
                <div key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
                  <span style={{ flexShrink: 0, marginTop: 1 }}>
                    <ForecastChip level={l.level} />
                  </span>
                  <span style={{ fontSize: 13.5, lineHeight: 1.6 }}>{l.text}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <KnownUnknownDisputed known={known} intel={intel} />
      </div>

      <div className="grid">
        <Panel title="Entities named">
          <div className="row" style={{ gap: 6 }}>
            {(intel.entities ?? []).map((e, i) => (
              <span key={i} className="chip">
                {e.type === "person" ? "👤" : e.type === "org" ? "🏢" : e.type === "place" ? "📍" : "•"} {e.name}
              </span>
            ))}
            {!(intel.entities ?? []).length && <span className="kud-empty">None extracted.</span>}
          </div>
        </Panel>

        {story.metrics.independence.broke_first && (
          <Panel title="Who broke it">
            <div className="verdict-value">{story.metrics.independence.broke_first.source_name}</div>
            <div className="verdict-sub">
              <Time at={story.metrics.independence.broke_first.published_at} mode="exact" />
              {" · "}
              {story.metrics.independence.broke_first.chain_label} chain
            </div>
          </Panel>
        )}

        <div className="card pad" style={{ background: "linear-gradient(135deg, rgba(91,227,200,0.07), rgba(79,195,255,0.05))" }}>
          <div className="section-label accent">✦ Podcast angle</div>
          <div style={{ fontSize: 14, lineHeight: 1.65, fontStyle: "italic" }}>{intel.podcast_angle}</div>
        </div>
      </div>
    </div>
  );
}

/** Prose with per-sentence citation markers. */
function CitedProse({ text, small }: { text: CitedTextView; small?: boolean }) {
  return (
    <div className="cited" style={small ? { fontSize: 13.5, lineHeight: 1.75 } : undefined}>
      {text.sentences.map((s, i) => (
        <span key={i}>
          <span className={`sent ${s.citations.length ? "backed" : "uncited"}`}>{s.text}</span>
          {s.citations.length > 0 && (
            <Explain
              title="Sources for this sentence"
              tone={s.tier === "reported" || s.tier === "disputed" ? "cite-weak" : "cite"}
              width={340}
              label={`${s.outlets.length}`}
            >
              {s.citations.map((c) => (
                <p className="ex-p" key={c.claim_id}>
                  <b>{TIER_TEXT[c.tier]?.label ?? c.tier}</b> — {c.claim}
                  <br />
                  <span className="dim">{c.outlets.join(", ")}</span>
                </p>
              ))}
              <p className="ex-p dim">
                Matched by content-word and entity containment against the verified claim set, not by asking a model
                whether the sentence is true.
              </p>
            </Explain>
          )}{" "}
        </span>
      ))}
      <div className="cite-note">
        <span>
          {text.cited} of {text.total} sentences backed ({text.coverage_pct}%)
        </span>
        <span className="dim">·</span>
        <span className="dim">grey underline = not supported by the evidence layer</span>
      </div>
    </div>
  );
}

function KnownUnknownDisputed({ known, intel }: { known: Evidence["known"] | null; intel: Intel }) {
  const solid = known?.solid?.length ? known.solid : (known?.consensus ?? intel.consensus ?? []);
  const contested = known?.contested?.length ? known.contested : (known?.disagreements ?? intel.disagreements ?? []);
  const unknown = known?.unknown ?? [];

  return (
    <Panel
      title="Known, contested, unknown"
      sub="The three questions a reader actually has"
      right={
        <Explain title="Where these come from" label="?" width={340}>
          <p className="ex-p">
            <b>Established</b> is drawn from the editorial pass&apos;s solid-ground list, falling back to points every
            outlet agrees on.
          </p>
          <p className="ex-p">
            <b>Contested</b> is where outlets disagree — different figures, different attributions, different
            emphasis on the same event.
          </p>
          <p className="ex-p">
            <b>Not known</b> is the honest gap: questions the coverage raises and does not answer. An empty column
            here means the analysis did not identify any, not that none exist.
          </p>
        </Explain>
      }
    >
      <div className="kud">
        <div className="kud-col solid">
          <div className="kud-head">✓ Established</div>
          {solid.length ? (
            <ul className="kud-list">
              {solid.slice(0, 6).map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          ) : (
            <div className="kud-empty">Nothing recorded yet.</div>
          )}
        </div>
        <div className="kud-col contested">
          <div className="kud-head">⚡ Contested</div>
          {contested.length ? (
            <ul className="kud-list">
              {contested.slice(0, 6).map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          ) : (
            <div className="kud-empty">No disagreement detected across these outlets.</div>
          )}
        </div>
        <div className="kud-col unknown">
          <div className="kud-head">? Not known</div>
          {unknown.length ? (
            <ul className="kud-list">
              {unknown.slice(0, 6).map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          ) : (
            <div className="kud-empty">
              No open questions identified. This is a limit of the analysis, not a claim that everything is known.
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ *
 * Tab 2 — the dossier
 * ------------------------------------------------------------------ */

const TIER_FILTER_ORDER: ClaimTier[] = ["confirmed", "corroborated", "disputed", "reported", "unverified"];

function DossierTab({ evidence, verifying, onVerify }: { evidence: Evidence | null; verifying: boolean; onVerify: () => void }) {
  const [tier, setTier] = useState<ClaimTier | "all">("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  if (!evidence) {
    return <div className="empty">The evidence layer has not run for this story yet.</div>;
  }
  if (!evidence.facts.length) {
    return (
      <Panel title="No claims on record" tone="warm">
        <p style={{ margin: "0 0 14px", fontSize: 13.5, lineHeight: 1.6 }}>
          Claim extraction runs with the intelligence pass. If this story was analysed before that change, re-run it
          here — no podcast required.
        </p>
        <button className="btn primary" onClick={onVerify} disabled={verifying}>
          {verifying ? "Extracting claims…" : "Verify this story"}
        </button>
      </Panel>
    );
  }

  const counts = evidence.tier_counts ?? {};
  const shown = tier === "all" ? evidence.facts : evidence.facts.filter((f) => f.tier === tier);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Panel
        title="Evidence summary"
        sub={evidence.coverage.independence.summary}
        right={
          <button className="btn sm" onClick={onVerify} disabled={verifying}>
            {verifying ? "Re-checking…" : "Re-verify"}
          </button>
        }
      >
        <div className="row" style={{ gap: 12, marginBottom: 14 }}>
          <EvidenceBadge evidence={evidence.coverage.evidence} />
          {evidence.contradictions.length > 0 && (
            <span className="tier tier-bad">
              <span className="tier-dot" aria-hidden>
                🔴
              </span>
              <span className="tier-label">
                {evidence.contradictions.length} {evidence.contradictions.length === 1 ? "conflict" : "conflicts"}
              </span>
            </span>
          )}
        </div>

        <div className="filters">
          <button className={`fpill ${tier === "all" ? "on" : ""}`} onClick={() => setTier("all")}>
            All<span className="n">{evidence.facts.length}</span>
          </button>
          {TIER_FILTER_ORDER.map((t) => (
            <button
              key={t}
              className={`fpill ${tier === t ? "on" : ""}`}
              onClick={() => setTier(t)}
              disabled={!counts[t]}
              title={evidence.methods.tiers[t]}
            >
              {TIER_TEXT[t].dot} {TIER_TEXT[t].label}
              <span className="n">{counts[t] ?? 0}</span>
            </button>
          ))}
        </div>
        <p className="dim" style={{ fontSize: 12, margin: "12px 0 0", lineHeight: 1.6 }}>
          Tiers count independent reporting chains, not outlets.{" "}
          <Link className="ex-link" href="/methodology#tiers">
            How each tier is defined
          </Link>
        </p>
      </Panel>

      {evidence.contradictions.length > 0 && (
        <Panel
          title="Sources conflict"
          tone="bad"
          sub="Shown side by side rather than resolved — the disagreement is the finding"
        >
          {evidence.contradictions.map((c) => {
            const other = c.against.find(Boolean);
            return (
              <div className="contra" key={c.fact_id}>
                <div className="contra-side">
                  <div className="contra-claim">{c.claim}</div>
                  <div className="contra-src">{c.claim_sources.join(", ") || "source not recorded"}</div>
                </div>
                <div className="contra-vs">VS</div>
                <div className="contra-side">
                  <div className="contra-claim">{other?.claim ?? "Contradicting claim no longer on record"}</div>
                  <div className="contra-src">{other?.sources?.join(", ") || "source not recorded"}</div>
                </div>
              </div>
            );
          })}
          <p className="dim" style={{ fontSize: 12, margin: "12px 0 0", lineHeight: 1.6 }}>
            Detected by comparing polarity and quantities within matched claim groups. A conflict here means the
            reports disagree, not that either is false.
          </p>
        </Panel>
      )}

      <Panel
        title={tier === "all" ? "All claims" : `${TIER_TEXT[tier].label} claims`}
        sub={`${shown.length} of ${evidence.facts.length} shown`}
      >
        <div>
          {shown.map((f) => (
            <div className={`claim ${expanded === f.id ? "is-active" : ""}`} key={f.id}>
              <div className="claim-text">{f.claim}</div>
              <div className="claim-meta">
                <TierBadge tier={f.tier} reason={f.tier_reason} outlets={f.outlets} chains={f.chains} />
                <span className="dim">
                  {f.independent_count} independent {f.independent_count === 1 ? "chain" : "chains"} ·{" "}
                  {f.outlet_count} {f.outlet_count === 1 ? "outlet" : "outlets"}
                </span>
                {f.first_reported_by && (
                  <span className="dim">
                    first: {f.first_reported_by}
                    {f.first_reported_at ? (
                      <>
                        {" "}
                        <Time at={f.first_reported_at} mode="exact" />
                      </>
                    ) : null}
                  </span>
                )}
                <Explain title="Confidence figure" label={`${Math.round(f.confidence * 100)}%`} tone="link" width={330}>
                  <p className="ex-p">{evidence.methods.confidence}</p>
                  <p className="ex-p dim">
                    It is a smoothing function over chain count, not a probability that the claim is true.
                  </p>
                </Explain>
                <button className="btn sm" onClick={() => setExpanded(expanded === f.id ? null : f.id)}>
                  {expanded === f.id ? "Hide sources" : `${f.attestations.length || f.outlets.length} sources`}
                </button>
              </div>

              {expanded === f.id && (
                <div style={{ marginTop: 11, display: "grid", gap: 8 }}>
                  {f.attestations.map((a, i) => (
                    /* Not an <a> wrapper: OriginalityChip opens a popover button, and a
                       button inside an anchor is invalid and breaks hydration. The outlet
                       name carries the link instead. */
                    <div
                      key={`${a.article_id}-${i}`}
                      style={{ display: "block", padding: "10px 12px", background: "var(--panel-2)", borderRadius: 9, border: "1px solid var(--line-soft)" }}
                    >
                      <div className="row" style={{ gap: 8, marginBottom: 5 }}>
                        {a.url ? (
                          <a href={a.url} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, fontWeight: 700 }}>
                            {a.source}
                          </a>
                        ) : (
                          <b style={{ fontSize: 12.5 }}>{a.source}</b>
                        )}
                        <OriginalityChip originality={a.originality} label={a.chain_label} />
                        <Time at={a.published_at} mode="exact" className="dim" />
                      </div>
                      {a.text && (
                        <div className="dim" style={{ fontSize: 12, lineHeight: 1.5, fontStyle: "italic" }}>
                          “{a.text}”
                        </div>
                      )}
                    </div>
                  ))}
                  {!f.attestations.length && (
                    <div className="kud-empty">
                      Attributed to {f.outlets.join(", ") || "no recorded outlet"} — this row predates per-article
                      attestation, so the exact sentences are not stored. Re-verify to rebuild it.
                    </div>
                  )}
                  {f.variants.length > 1 && (
                    <div className="dim" style={{ fontSize: 12, lineHeight: 1.6 }}>
                      <b style={{ color: "var(--text-2)" }}>Other phrasings grouped into this claim:</b>
                      <ul style={{ margin: "5px 0 0", paddingLeft: 16 }}>
                        {f.variants.slice(1, 5).map((v, i) => (
                          <li key={i}>{v}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </Panel>

      {evidence.living_story && (
        <Panel
          title={`Living story · v${evidence.living_story.version}`}
          sub={
            <>
              Last fused <Time at={evidence.living_story.last_fused_at} mode="both" /> ·{" "}
              {evidence.living_story.timeline.length} timeline events
            </>
          }
        >
          <p style={{ margin: 0, lineHeight: 1.65, fontSize: 14 }}>{evidence.living_story.current_summary}</p>
        </Panel>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Tab 3 — coverage comparison
 * ------------------------------------------------------------------ */

function CoverageTab({ intel, coverage }: { intel: Intel; coverage: CoverageView | null }) {
  if (!coverage) return <div className="empty">Coverage comparison is unavailable for this story.</div>;
  const { outlets, broke_first, movers, followers, gaps, spread_label } = coverage;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Panel
        title="Who moved this story"
        sub="Derived from publication order, bylines and claim overlap — no model call"
        right={
          <Explain title="How this is worked out" label="Method" tone="link" width={360}>
            <p className="ex-p">{coverage.method}</p>
          </Explain>
        }
      >
        <div className="verdict">
          <div className="verdict-cell">
            <div className="verdict-label">Broke it first</div>
            <div className="verdict-value">{broke_first?.source ?? "—"}</div>
            <div className="verdict-sub">
              {broke_first ? (
                <>
                  <Time at={broke_first.at} mode="exact" />
                  {broke_first.lead_label ? ` · ${broke_first.lead_label}` : ""}
                </>
              ) : (
                "No coverage recorded"
              )}
            </div>
          </div>
          <div className="verdict-cell">
            <div className="verdict-label">Added new facts</div>
            <div className="verdict-value">{movers.length ? movers.join(", ") : "None"}</div>
            <div className="verdict-sub">
              {movers.length
                ? "Carried at least one checkable claim no other outlet in this set had."
                : "Every claim in this story appears in more than one outlet."}
            </div>
          </div>
          <div className="verdict-cell">
            <div className="verdict-label">Added nothing new</div>
            <div className="verdict-value">{followers.length ? followers.join(", ") : "None"}</div>
            <div className="verdict-sub">
              {followers.length
                ? "Every claim they carried had already been reported by an earlier filing."
                : "Every outlet contributed at least one claim first."}
            </div>
          </div>
          <div className="verdict-cell">
            <div className="verdict-label">Coverage window</div>
            <div className="verdict-value">{spread_label}</div>
            <div className="verdict-sub">Between the first and most recent filing in this cluster.</div>
          </div>
        </div>
      </Panel>

      <Panel title="Comparison" sub="One row per filing, in publication order">
        <div className="table-scroll">
          <table className="ctable">
            <thead>
              <tr>
                <th>Source</th>
                <th>Published</th>
                <th>Provenance</th>
                <th className="num">Claims</th>
                <th className="num">Unique</th>
                <th className="num">First to file</th>
                <th className="num">Overlap</th>
                <th>Angle</th>
              </tr>
            </thead>
            <tbody>
              {outlets.map((o) => (
                <tr key={o.article_id}>
                  <td className="lead">
                    <a href={o.url} target="_blank" rel="noreferrer">
                      {o.source}
                    </a>
                    <div style={{ marginTop: 4 }}>
                      <LeanChip lean={o.lean} />
                    </div>
                  </td>
                  <td>
                    <Time at={o.published_at} mode="exact" />
                    <div className="dim" style={{ marginTop: 3, fontSize: 11.5 }}>
                      {o.lag_label}
                    </div>
                  </td>
                  <td>
                    <OriginalityChip
                      originality={o.originality}
                      label={o.originality_label}
                      basis={o.basis}
                      chainLabel={o.chain_label}
                    />
                  </td>
                  <td className="num">{o.claims_carried}</td>
                  <td className="num">
                    {o.unique_claims > 0 ? (
                      <Explain title={`Only ${o.source} reported`} label={String(o.unique_claims)} tone="link" width={330}>
                        {o.unique_examples.map((e, i) => (
                          <p className="ex-p" key={i}>
                            {e}
                          </p>
                        ))}
                        <p className="ex-p dim">
                          No other article in this cluster carried these. Unique does not mean verified — a single-source
                          claim sits in the Reported tier.
                        </p>
                      </Explain>
                    ) : (
                      "0"
                    )}
                  </td>
                  <td className="num">{o.added_first}</td>
                  <td className="num">{o.claims_carried ? `${o.overlap_pct}%` : "—"}</td>
                  <td style={{ maxWidth: 260 }}>{o.angle ?? <span className="dim">not analysed</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="dim" style={{ fontSize: 12, margin: "14px 0 0", lineHeight: 1.6 }}>
          <b style={{ color: "var(--text-2)" }}>Claims</b> — checkable assertions extracted from this filing.{" "}
          <b style={{ color: "var(--text-2)" }}>Unique</b> — claims no other filing carried.{" "}
          <b style={{ color: "var(--text-2)" }}>First to file</b> — claims that had not appeared in any earlier
          article. <b style={{ color: "var(--text-2)" }}>Overlap</b> — share of this filing&apos;s claims that others
          also carried.
        </p>
      </Panel>

      {gaps.length > 0 && (
        <Panel title="Coverage gaps" sub="What is missing from some accounts and present in others" tone="warm">
          <ul className="kud-list" style={{ fontSize: 13 }}>
            {gaps.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
          <p className="dim" style={{ fontSize: 12, margin: "10px 0 0", lineHeight: 1.6 }}>
            A gap is often house style or wire length rather than an editorial decision. It is listed as a gap, not an
            accusation.
          </p>
        </Panel>
      )}

      <div className="grid c2">
        {outlets.map((o) => (
          <Panel
            key={`${o.article_id}-card`}
            title={
              <span className="row" style={{ gap: 8 }}>
                {o.source}
                {o.tone && <span title={o.tone}>{TONE_EMOJI[o.tone] ?? "📰"}</span>}
              </span>
            }
            sub={
              <>
                <Time at={o.published_at} mode="exact" /> · {o.lag_label}
              </>
            }
            right={<OriginalityChip originality={o.originality} label={o.originality_label} basis={o.basis} chainLabel={o.chain_label} />}
          >
            <a href={o.url} target="_blank" rel="noreferrer" className="muted" style={{ fontSize: 13, fontStyle: "italic", display: "block", marginBottom: 10 }}>
              “{o.title}”
            </a>
            {o.angle && <p style={{ fontSize: 13.5, lineHeight: 1.6, margin: "0 0 10px" }}>{o.angle}</p>}
            {o.emphasis.length > 0 && (
              <div className="row" style={{ gap: 5, marginBottom: 10 }}>
                {o.emphasis.map((e, j) => (
                  <span key={j} className="chip src">
                    {e}
                  </span>
                ))}
              </div>
            )}
            <div className="row" style={{ gap: 16, fontSize: 12, marginBottom: 10 }}>
              <span>
                <b>{o.claims_carried}</b> <span className="dim">claims</span>
              </span>
              <span>
                <b style={{ color: o.unique_claims ? "var(--good)" : undefined }}>{o.unique_claims}</b>{" "}
                <span className="dim">only here</span>
              </span>
              <span>
                <b>{o.added_first}</b> <span className="dim">filed first</span>
              </span>
              <LeanChip lean={o.lean} />
            </div>
            {o.coverage_gap && (
              <div className="dim" style={{ fontSize: 12.5, lineHeight: 1.55 }}>
                <b style={{ color: "var(--warm)" }}>Coverage gap:</b> {o.coverage_gap}
              </div>
            )}
            {!o.angle && !o.coverage_gap && (
              <div className="kud-empty">
                No comparative reading for this outlet — the framing pass covered {intel.framing?.length ?? 0} of the
                filings.
              </div>
            )}
          </Panel>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Tab 4 — timeline
 * ------------------------------------------------------------------ */

function TimelineTab({
  intel,
  coverage,
  living,
}: {
  intel: Intel;
  coverage: CoverageView | null;
  living: Evidence["living_story"];
}) {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      {coverage && coverage.waves.length > 0 && (
        <Panel
          title="How the story broke"
          sub="Measured from feed timestamps, not from the narrative"
          right={
            <Explain title="Reading this timeline" label="?" width={340}>
              <p className="ex-p">
                <b>Event occurred</b> is the earliest dated moment in the reconstructed timeline, shown only when it
                predates all coverage — so the delay between an event and its first report is visible.
              </p>
              <p className="ex-p">
                <b>First coverage</b> is the earliest filing in the feed, which can lag an outlet&apos;s own website by
                a few minutes.
              </p>
              <p className="ex-p dim">Every later row shows its distance from first coverage.</p>
            </Explain>
          }
        >
          <div className="tl">
            {coverage.waves.map((w, i) => (
              <div className={`tl-item kind-${w.kind}`} key={`${w.at}-${i}`}>
                <div className="tl-when">
                  <Time at={w.at} mode="exact" />
                </div>
                <div className="tl-node">
                  <span className="tl-dot" />
                </div>
                <div>
                  <div className="tl-label">{w.label}</div>
                  {w.url ? (
                    <a href={w.url} target="_blank" rel="noreferrer" className="tl-detail" style={{ display: "block" }}>
                      {w.detail}
                    </a>
                  ) : (
                    <div className="tl-detail">{w.detail}</div>
                  )}
                  {w.delta_label && <div className="tl-delta">{w.delta_label}</div>}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {(intel.timeline ?? []).length > 0 && (
        <Panel
          title="Reconstructed sequence of events"
          sub="Model-assembled from the articles — the dates are as reported, not measured"
        >
          <div className="tl">
            {intel.timeline.map((t, i) => (
              <div className="tl-item" key={i}>
                <div className="tl-when mono">{t.time}</div>
                <div className="tl-node">
                  <span className="tl-dot" />
                </div>
                <div>
                  <div className="tl-detail">{t.event}</div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {living && living.timeline.length > 0 && (
        <Panel
          title="Story updates"
          sub={
            <>
              Fused across {living.version} {living.version === 1 ? "revision" : "revisions"} · last{" "}
              <Time at={living.last_fused_at} mode="both" />
            </>
          }
        >
          <div className="tl">
            {living.timeline
              .slice(-14)
              .reverse()
              .map((e, i) => (
                <div className="tl-item" key={i}>
                  <div className="tl-when mono">{e.t}</div>
                  <div className="tl-node">
                    <span className="tl-dot" />
                  </div>
                  <div>
                    <div className="tl-detail">{e.event}</div>
                  </div>
                </div>
              ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Tab 5 — sources
 * ------------------------------------------------------------------ */

function SourcesTab({ story, coverage }: { story: Story; coverage: CoverageView | null }) {
  const provByArticle = new Map((coverage?.outlets ?? []).map((o) => [o.article_id, o]));

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Panel title="Reporting chains" sub={coverage?.independence.summary ?? story.metrics.evidence.summary}>
        <div className="stack">
          {(coverage?.independence.chains ?? story.metrics.independence.chains).map((c) => (
            <div key={c.label} className="row" style={{ justifyContent: "space-between", gap: 12 }}>
              <span style={{ fontSize: 13.5 }}>
                <b>{c.label}</b>{" "}
                <span className="dim">
                  ({c.kind === "agency" ? "wire agency" : "newsroom"})
                </span>
              </span>
              <span className="dim" style={{ fontSize: 12.5 }}>
                {c.outlets.join(", ")}
              </span>
            </div>
          ))}
        </div>
        {story.metrics.evidence.caveat && (
          <p style={{ fontSize: 12.5, color: "var(--warm)", margin: "12px 0 0", lineHeight: 1.6 }}>
            {story.metrics.evidence.caveat}
          </p>
        )}
      </Panel>

      <div className="card">
        {story.articles.map((a) => {
          const p = provByArticle.get(a.id);
          return (
            <div key={a.id} className="story-row" style={{ gridTemplateColumns: "1fr auto" }}>
              <div style={{ minWidth: 0 }}>
                <div className="story-title">
                  <a href={a.url} target="_blank" rel="noreferrer">
                    {a.title}
                  </a>
                </div>
                <div className="story-meta">
                  <span className="chip src">{a.source_name}</span>
                  <LeanChip lean={a.lean} />
                  {p && <OriginalityChip originality={p.originality} label={p.originality_label} basis={p.basis} chainLabel={p.chain_label} />}
                  <Time at={a.published_at} mode="exact" />
                  {a.author ? <span className="dim">by {a.author}</span> : <span className="dim">no byline in feed</span>}
                  {p && p.lag_ms > 0 && <span className="dim">{p.lag_label}</span>}
                </div>
              </div>
              <a href={a.url} target="_blank" rel="noreferrer" className="btn sm" style={{ fontSize: 12 }}>
                Read ↗
              </a>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Empty state + episode strip
 * ------------------------------------------------------------------ */

function NoIntelligence({ story, analyzing, onAnalyze }: { story: Story; analyzing: boolean; onAnalyze: () => void }) {
  return (
    <>
      <div className="card pad" style={{ textAlign: "center", padding: 46, marginBottom: 18 }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>✦</div>
        <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>Not analysed yet</div>
        <div className="muted" style={{ marginBottom: 20, maxWidth: 520, margin: "0 auto 20px", lineHeight: 1.6 }}>
          One pass extracts the claims, counts how many independent newsrooms carried each one, looks for
          contradictions and compares how each outlet framed it. No podcast required.
        </div>
        <button className="btn primary" onClick={onAnalyze} disabled={analyzing}>
          {analyzing ? "Analysing…" : "Run intelligence & verify"}
        </button>
      </div>
      <Panel title="Raw coverage" sub={`${story.articles.length} filings in this cluster`}>
        <div className="stack">
          {story.articles.map((a) => (
            <a key={a.id} href={a.url} target="_blank" rel="noreferrer" style={{ display: "block" }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{a.title}</div>
              <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>
                {a.source_name} · <Time at={a.published_at} mode="exact" />
              </div>
            </a>
          ))}
        </div>
      </Panel>
    </>
  );
}

function EpisodeStrip({ episodeId, initialEpisode }: { episodeId: string; initialEpisode: EpisodeLite }) {
  const [ep, setEp] = useState<EpisodeLite & { progress?: number; stage_label?: string }>(initialEpisode);
  const running = !["ready", "failed"].includes(ep.status);
  useInterval(
    async () => {
      try {
        setEp(await api<EpisodeLite & { progress: number; stage_label: string }>(`/api/episodes/${episodeId}`));
      } catch {
        /* transient */
      }
    },
    running ? 2500 : null,
  );

  const pct = Math.round((ep.progress ?? 0) * 100);
  const statusColor = ep.status === "ready" ? "var(--good)" : ep.status === "failed" ? "var(--bad)" : "var(--warm)";
  const statusLabel = ep.status === "ready" ? "✓ ready" : ep.status === "failed" ? "✕ failed" : ep.stage_label ?? ep.status;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: "var(--panel-2)", borderRadius: 10, border: "1px solid var(--line-soft)" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {ep.title && ep.title !== "Generating…" ? ep.title : `${ep.format} · ${ep.language.toUpperCase()}`}
        </div>
        <div className="dim" style={{ fontSize: 11.5, marginTop: 2 }}>
          {ep.format} · {ep.language.toUpperCase()} · <Time at={ep.created_at} mode="exact" />
        </div>
        {running && (
          <div style={{ marginTop: 6 }}>
            <div className="progress-track" style={{ height: 4 }}>
              <div className="progress-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="mono dim" style={{ fontSize: 10.5, marginTop: 3 }}>
              {statusLabel}
            </div>
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
        <span style={{ fontSize: 12, color: statusColor, fontWeight: 600 }}>
          {ep.status === "ready" ? "✓ ready" : running ? "●" : "✕"}
        </span>
        <Link href={`/studio/${episodeId}`} className="btn sm" style={{ fontSize: 12 }}>
          Open studio
        </Link>
      </div>
    </div>
  );
}

/** "2 days ago" for the heat-decay note, without pulling in a formatter. */
function relDays(ts: number): string {
  const h = (Date.now() - ts) / 3_600_000;
  if (h < 1) return "moments ago";
  if (h < 24) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
