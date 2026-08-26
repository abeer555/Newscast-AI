/**
 * The publish gate, and the chain that connects a claim to what the listener hears.
 *
 * Two things are computed here.
 *
 * First, a **deterministic** publish decision. The old gate was a single number
 * produced by a model asked to score itself, which is the least trustworthy way to
 * decide whether something is fit to publish: it cannot be audited, it cannot be
 * reproduced, and it has an obvious incentive to like its own work. This module
 * replaces it with a fixed set of checks over stored data. Each check states what
 * it measured, the rule it applied, how many points it is worth, how many it
 * earned, and — when it did not pass — what to do about it and where to go. A
 * score of 61 is therefore always answerable: it is the sum of nine numbers you
 * can read. The model's own opinion is still shown, but as clearly-labelled
 * advice sitting beside the arithmetic rather than standing in for it.
 *
 * Second, the **media chain**: claim → script sentence → audio timestamp → video
 * beat, in both directions. Script sentences are matched to verified claims with
 * the same containment matcher the story page uses, so the two surfaces cannot
 * disagree. Timings come from the measured per-utterance audio timeline when the
 * episode was voiced with timing capture, and fall back to a word-proportional
 * estimate otherwise — the difference is reported rather than hidden, because a
 * highlighted transcript line that is quietly guessing is worse than one that
 * admits it.
 *
 * Nothing in this file calls a model.
 */

import { getDb } from "./db";
import { citeText, type CitableFact, type Citation } from "./cite";
import { type Attestation, type ClaimTier } from "./verification";
import type { PodcastScript } from "./scriptgen";
import type { Beat } from "./storyboard";

/* ------------------------------------------------------------------ *
 * Gate
 * ------------------------------------------------------------------ */

export type CheckStatus = "pass" | "warn" | "fail";

export interface GateCheck {
  id: string;
  label: string;
  status: CheckStatus;
  /** Maximum points this check can contribute. */
  weight: number;
  /** Points actually earned, 0..weight. */
  earned: number;
  /** What was measured, in numbers. */
  measured: string;
  /** The rule that turned that measurement into a status. */
  rule: string;
  /** The concrete next action, when the check did not pass. */
  fix: string | null;
  /** Where in the studio the reader should go to act on it. */
  target: { tab: StudioTab; segment?: number } | null;
}

export type StudioTab = "script" | "listen" | "watch" | "review";

export interface GateAdvisory {
  publish_confidence: number | null;
  decision: string | null;
  reasons: string[];
  improvements: string[];
  notes: string;
}

export interface EpisodeGate {
  episode_id: string;
  /** 0-100, the sum of the earned points below. Nothing is normalised. */
  score: number;
  verdict: "publish" | "needs_review";
  /** Ids of checks that fail outright; any one of these blocks publication. */
  blocking: string[];
  checks: GateCheck[];
  headline: string;
  summary: string;
  method: string;
  advisory: GateAdvisory | null;
  /** Set when a human published over a blocked gate. */
  override: { at: number; note: string } | null;
  computed_at: number;
}

/** A gate must clear this and have no failing check to publish. */
export const PUBLISH_THRESHOLD = 72;

/* ------------------------------------------------------------------ *
 * Media chain
 * ------------------------------------------------------------------ */

/** One spoken utterance as it was actually voiced, with measured duration. */
export interface Utterance {
  start: number;
  end: number;
  text: string;
  voice: string;
  /** Script segment indices merged into this utterance. */
  segments: number[];
}

export type BackingLevel = "high" | "moderate" | "low" | "none";

export interface SegmentBacking {
  index: number;
  speaker: string;
  text: string;
  /** Strongest tier across the claims backing this segment. */
  tier: ClaimTier | null;
  level: BackingLevel;
  /** Short phrase for the player, e.g. "3 supporting sources · High confidence". */
  label: string;
  outlets: string[];
  independent: number;
  claim_ids: string[];
  citations: Citation[];
  /** Share of this segment's sentences that matched a verified claim, 0-100. */
  sentence_coverage: number;
}

export interface SegmentTiming {
  index: number;
  start: number;
  end: number;
  /** True when the bounds come from measured audio rather than an estimate. */
  measured: boolean;
}

export interface BeatLink {
  index: number;
  caption: string;
  start: number;
  end: number;
  segment_range: [number, number];
  provenance: {
    kind: "source_photo" | "ai_illustration" | "unknown";
    label: string;
    detail: string;
    outlet: string | null;
    url: string | null;
    quality_score: number | null;
  };
  claim_ids: string[];
}

export interface ClaimLink {
  id: string;
  claim: string;
  tier: ClaimTier;
  outlets: string[];
  independent_count: number;
  /** Script segments that carry this claim. */
  segments: number[];
  /** Audio offset of the first segment that carries it, or null if unspoken. */
  first_at: number | null;
  beats: number[];
}

export interface EpisodeMedia {
  episode_id: string;
  audio_duration: number;
  timings: SegmentTiming[];
  timing_method: string;
  timing_measured: boolean;
  backing: SegmentBacking[];
  beats: BeatLink[];
  claims: ClaimLink[];
  /** Share of script segments backed by at least one verified claim, 0-100. */
  coverage_pct: number;
  spoken_claim_count: number;
  total_claim_count: number;
  method: string;
}

/* ------------------------------------------------------------------ *
 * Loading
 * ------------------------------------------------------------------ */

interface EpisodeRow {
  id: string;
  cluster_id: string;
  title: string;
  status: string;
  script: string | null;
  audio_path: string | null;
  audio_duration: number | null;
  audio_timeline: string | null;
  storyboard: string | null;
  visual_provenance: string | null;
  evaluation: string | null;
  published_at: number | null;
}

/** Column names actually present, so a pre-migration database still answers. */
function columnsOf(table: string): Set<string> {
  try {
    const rows = getDb().prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    return new Set(rows.map((r) => r.name));
  } catch {
    return new Set();
  }
}

function loadEpisode(episodeId: string): EpisodeRow | null {
  const cols = columnsOf("episodes");
  const want = [
    "id",
    "cluster_id",
    "title",
    "status",
    "script",
    "audio_path",
    "audio_duration",
    "audio_timeline",
    "storyboard",
    "visual_provenance",
    "evaluation",
    "published_at",
  ];
  const select = want.map((c) => (cols.has(c) ? c : `NULL AS ${c}`)).join(", ");
  try {
    return (getDb().prepare(`SELECT ${select} FROM episodes WHERE id=?`).get(episodeId) as EpisodeRow) ?? null;
  } catch {
    return null;
  }
}

interface FactRow {
  id: string;
  claim: string;
  support_count: number;
  attestation_json: string;
  contradicted_by: string | null;
  confidence: number;
  tier?: string | null;
  independent_count?: number | null;
  outlet_count?: number | null;
}

/** Claims for a story, with the same tier fallback the evidence route uses. */
function loadFacts(clusterId: string): { fact: FactRow; tier: ClaimTier; outlets: string[]; independent: number }[] {
  const cols = columnsOf("cluster_facts");
  const want = ["id", "claim", "support_count", "attestation_json", "contradicted_by", "confidence", "tier", "independent_count", "outlet_count"];
  const select = want.map((c) => (cols.has(c) ? c : `NULL AS ${c}`)).join(", ");
  let rows: FactRow[] = [];
  try {
    rows = getDb().prepare(`SELECT ${select} FROM cluster_facts WHERE cluster_id=?`).all(clusterId) as FactRow[];
  } catch {
    return [];
  }
  return rows.map((fact) => {
    let attestations: Attestation[] = [];
    try {
      attestations = JSON.parse(fact.attestation_json) as Attestation[];
    } catch {
      attestations = [];
    }
    const outlets = [...new Set(attestations.map((a) => a.source).filter(Boolean))];
    const chains = [...new Set(attestations.map((a) => a.chain_label).filter(Boolean))];
    const independent = fact.independent_count ?? (chains.length || fact.support_count || 0);
    return { fact, tier: tierOf(fact, independent), outlets, independent };
  });
}

function tierOf(f: FactRow, independent: number): ClaimTier {
  if (f.tier) return f.tier as ClaimTier;
  if (f.contradicted_by) return "disputed";
  if (independent >= 3) return "confirmed";
  if (independent === 2) return "corroborated";
  if (independent === 1) return "reported";
  return "unverified";
}

/* ------------------------------------------------------------------ *
 * Timings
 * ------------------------------------------------------------------ */

const ESTIMATE_METHOD =
  "No measured timeline was captured for this audio, so each line's position is estimated by sharing the total duration between segments in proportion to their word count. Treat the highlight as approximate.";
const MEASURED_METHOD =
  "Each utterance was timed from the audio it produced: the WAV written for that utterance is measured byte-exactly and the offsets accumulate. Within an utterance that merges several script lines, the line boundaries are split by character count.";

function parseTimeline(raw: string | null): Utterance[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v
      .map((u: Record<string, unknown>) => ({
        start: Number(u.start) || 0,
        end: Number(u.end) || 0,
        text: String(u.text ?? ""),
        voice: String(u.voice ?? ""),
        segments: Array.isArray(u.segments) ? u.segments.map(Number).filter((n) => Number.isFinite(n)) : [],
      }))
      .filter((u) => u.end > u.start);
  } catch {
    return [];
  }
}

/**
 * Per-segment start/end times.
 *
 * With a measured utterance timeline, a segment's bounds come from the utterance
 * that voiced it, subdivided by character count when several segments were merged
 * into one TTS call. Without one, the whole duration is shared out by word count.
 */
export function segmentTimings(script: PodcastScript, durationSec: number, timeline: Utterance[]): { timings: SegmentTiming[]; measured: boolean } {
  const segs = script.segments ?? [];
  if (!segs.length) return { timings: [], measured: false };

  if (timeline.length) {
    const out = new Map<number, SegmentTiming>();
    for (const u of timeline) {
      const members = u.segments.filter((i) => i >= 0 && i < segs.length);
      if (!members.length) continue;
      const lens = members.map((i) => Math.max(1, segs[i].text.length));
      const total = lens.reduce((a, b) => a + b, 0);
      let t = u.start;
      members.forEach((i, k) => {
        const dur = ((u.end - u.start) * lens[k]) / total;
        const prev = out.get(i);
        // A segment split across utterances keeps the earliest start and latest end.
        out.set(i, {
          index: i,
          start: prev ? Math.min(prev.start, round2(t)) : round2(t),
          end: prev ? Math.max(prev.end, round2(t + dur)) : round2(t + dur),
          measured: true,
        });
        t += dur;
      });
    }
    if (out.size) {
      const timings = segs.map(
        (s, i) => out.get(i) ?? { index: i, start: 0, end: 0, measured: false },
      );
      // Any segment the timeline never mentioned (empty text, for instance) is
      // marked unmeasured rather than silently given a zero-length slot.
      return { timings, measured: timings.every((t) => t.measured) };
    }
  }

  const weights = segs.map((s) => Math.max(1, s.text.split(/\s+/).filter(Boolean).length));
  const total = weights.reduce((a, b) => a + b, 0);
  const span = durationSec > 0 ? durationSec : script.estimated_seconds || total / 2.6;
  let t = 0;
  const timings = segs.map((_, i) => {
    const dur = (weights[i] / total) * span;
    const row: SegmentTiming = { index: i, start: round2(t), end: round2(t + dur), measured: false };
    t += dur;
    return row;
  });
  return { timings, measured: false };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/* ------------------------------------------------------------------ *
 * Backing
 * ------------------------------------------------------------------ */

const TIER_RANK: Record<ClaimTier, number> = { confirmed: 4, corroborated: 3, disputed: 2, reported: 1, unverified: 0 };

function levelFor(tier: ClaimTier | null, independent: number): BackingLevel {
  if (!tier) return "none";
  if (tier === "disputed") return "low";
  if (tier === "confirmed" || independent >= 3) return "high";
  if (tier === "corroborated" || independent === 2) return "moderate";
  return "low";
}

const LEVEL_WORD: Record<BackingLevel, string> = {
  high: "High confidence",
  moderate: "Moderate confidence",
  low: "Low confidence",
  none: "Not backed by the evidence layer",
};

function labelFor(level: BackingLevel, outlets: number, tier: ClaimTier | null): string {
  if (level === "none") return LEVEL_WORD.none;
  if (tier === "disputed") return `${outlets} ${outlets === 1 ? "source" : "sources"} · sources conflict here`;
  return `${outlets} supporting ${outlets === 1 ? "source" : "sources"} · ${LEVEL_WORD[level]}`;
}

/* ------------------------------------------------------------------ *
 * Provenance
 * ------------------------------------------------------------------ */

interface StoredBeat extends Beat {
  original_url?: string;
  fact_ids?: string[];
  mode?: string;
}

/** Maps an image URL back to the outlet that published it, when we can. */
function outletForUrl(clusterId: string, url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const rows = getDb()
      .prepare(
        `SELECT s.name AS name, a.image_url AS image_url, a.url AS url
         FROM cluster_articles ca JOIN articles a ON a.id=ca.article_id JOIN sources s ON s.id=a.source_id
         WHERE ca.cluster_id=?`,
      )
      .all(clusterId) as { name: string; image_url: string | null; url: string | null }[];
    const hit = rows.find((r) => r.image_url === url || r.url === url);
    if (hit) return hit.name;
    // Fall back to host matching, which covers CDN variants of the same outlet.
    const host = safeHost(url);
    if (!host) return null;
    const byHost = rows.find((r) => safeHost(r.url) === host || safeHost(r.image_url) === host);
    return byHost?.name ?? null;
  } catch {
    return null;
  }
}

function safeHost(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    return new URL(u).host.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function provenanceFor(clusterId: string, beat: StoredBeat): BeatLink["provenance"] {
  const url = beat.original_url ?? (beat.frame_path && /^https?:/.test(beat.frame_path) ? beat.frame_path : null);
  if (beat.image_source === "article") {
    const outlet = outletForUrl(clusterId, url);
    return {
      kind: "source_photo",
      label: outlet ? `Source image — ${outlet}` : "Source image — outlet unresolved",
      detail: outlet
        ? `Photograph published with the coverage by ${outlet} and reused unaltered. Nothing in this frame was generated.`
        : "Photograph scraped from the coverage of this story. The outlet could not be matched back from the image URL, so it is shown unattributed rather than attributed to a guess.",
      outlet,
      url: url ?? null,
      quality_score: beat.quality_score ?? null,
    };
  }
  if (beat.image_source === "ai_generated") {
    return {
      kind: "ai_illustration",
      label: "AI-generated illustration",
      detail:
        "Not a photograph of the event. Generated locally from a text prompt written for this beat, so it depicts the subject symbolically and must not be read as documentary evidence.",
      outlet: null,
      url: null,
      quality_score: beat.quality_score ?? null,
    };
  }
  return {
    kind: "unknown",
    label: "Provenance not recorded",
    detail:
      "This beat was rendered before provenance was tracked, so we cannot state whether the frame is a source photograph or a generated illustration. Re-render the video to label it.",
    outlet: null,
    url: null,
    quality_score: beat.quality_score ?? null,
  };
}

/* ------------------------------------------------------------------ *
 * The chain
 * ------------------------------------------------------------------ */

export function episodeMedia(episodeId: string): EpisodeMedia | null {
  const ep = loadEpisode(episodeId);
  if (!ep?.script) return null;
  let script: PodcastScript;
  try {
    script = JSON.parse(ep.script) as PodcastScript;
  } catch {
    return null;
  }
  const segs = script.segments ?? [];
  const facts = loadFacts(ep.cluster_id);
  const citable: CitableFact[] = facts.map((f) => ({
    id: f.fact.id,
    claim: f.fact.claim,
    tier: f.tier,
    outlets: f.outlets,
    independent_count: f.independent,
    confidence: f.fact.confidence,
  }));

  const timeline = parseTimeline(ep.audio_timeline);
  const duration = ep.audio_duration ?? 0;
  const { timings, measured } = segmentTimings(script, duration, timeline);

  const backing: SegmentBacking[] = segs.map((s, i) => {
    const cited = citeText(s.text, citable);
    const citations = cited.sentences.flatMap((x) => x.citations);
    const unique = new Map(citations.map((c) => [c.claim_id, c]));
    const kept = [...unique.values()].sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier] || b.match - a.match);
    const tier = kept.reduce<ClaimTier | null>((acc, c) => (acc === null || TIER_RANK[c.tier] > TIER_RANK[acc] ? c.tier : acc), null);
    const outlets = [...new Set(kept.flatMap((c) => c.outlets))];
    const independent = kept.reduce((m, c) => Math.max(m, c.independent_count), 0);
    const level = levelFor(tier, independent);
    return {
      index: i,
      speaker: s.speaker,
      text: s.text,
      tier,
      level,
      label: labelFor(level, outlets.length, tier),
      outlets,
      independent,
      claim_ids: kept.map((c) => c.claim_id),
      citations: kept,
      sentence_coverage: cited.coverage_pct,
    };
  });

  // Beats, with their own on-screen window and the claims their narration carries.
  let beats: BeatLink[] = [];
  try {
    const board = ep.storyboard ? (JSON.parse(ep.storyboard) as { beats: StoredBeat[] }) : null;
    if (board?.beats?.length) {
      beats = board.beats.map((b) => {
        const [from, to] = b.segment_range ?? [0, 0];
        const covered = backing.filter((x) => x.index >= from && x.index <= to);
        const startT = timings[from]?.start ?? 0;
        const endT = timings[Math.min(to, timings.length - 1)]?.end ?? startT + (b.duration ?? 0);
        return {
          index: b.index,
          caption: b.caption ?? "",
          start: round2(startT),
          end: round2(endT),
          segment_range: [from, to] as [number, number],
          provenance: provenanceFor(ep.cluster_id, b),
          claim_ids: [...new Set(covered.flatMap((c) => c.claim_ids))],
        };
      });
    }
  } catch {
    beats = [];
  }

  // Claims, pointing forwards into the audio and the video.
  const claims: ClaimLink[] = facts.map((f) => {
    const inSegments = backing.filter((b) => b.claim_ids.includes(f.fact.id)).map((b) => b.index);
    const firstSeg = inSegments.length ? Math.min(...inSegments) : null;
    return {
      id: f.fact.id,
      claim: f.fact.claim,
      tier: f.tier,
      outlets: f.outlets,
      independent_count: f.independent,
      segments: inSegments,
      first_at: firstSeg !== null ? (timings[firstSeg]?.start ?? null) : null,
      beats: beats.filter((b) => b.claim_ids.includes(f.fact.id)).map((b) => b.index),
    };
  });

  const backed = backing.filter((b) => b.claim_ids.length).length;
  return {
    episode_id: ep.id,
    audio_duration: duration,
    timings,
    timing_method: measured ? MEASURED_METHOD : ESTIMATE_METHOD,
    timing_measured: measured,
    backing,
    beats,
    claims,
    coverage_pct: segs.length ? Math.round((backed / segs.length) * 100) : 0,
    spoken_claim_count: claims.filter((c) => c.segments.length).length,
    total_claim_count: claims.length,
    method:
      "Script lines are matched to the story's verified claims by content-word and entity containment — the same matcher the story page uses for inline citation, so a line cited here is cited there. A line with no claim is not necessarily wrong; it may be narration or transition, but nothing in the evidence layer supports it.",
  };
}

/* ------------------------------------------------------------------ *
 * Checks
 * ------------------------------------------------------------------ */

const CONTRAST_MARKERS = /\b(but|however|although|though|whereas|by contrast|on the other hand|disput|deni|contradict|conflict|unconfirmed|not verified|differ|reject|contest)/i;
const CONSENSUS_CLAIMS = /\b(\d+\s+(?:outlets?|sources?|newsrooms?)|multiple (?:outlets?|sources?)|all (?:major )?outlets?|every (?:major )?outlet|widely (?:confirmed|reported)|outlets? confirm|sources? confirm|confirmed by (?:multiple|several))\b/i;
const SINGLE_SOURCE_HEDGE = /\b(single|sole|one outlet|only outlet|only one|not independently|yet to be|has not been (?:confirmed|corroborated)|unconfirmed|according to (?:a|one) (?:single )?report)\b/i;

function pct(n: number): string {
  return `${Math.round(n)}%`;
}

/** Points scaled linearly between a floor and a ceiling measurement. */
function scaled(value: number, floor: number, ceil: number, weight: number): number {
  if (ceil <= floor) return value >= ceil ? weight : 0;
  const t = (value - floor) / (ceil - floor);
  return Math.round(Math.max(0, Math.min(1, t)) * weight * 10) / 10;
}

interface CheckInput {
  episode: EpisodeRow;
  script: PodcastScript | null;
  media: EpisodeMedia | null;
  facts: { fact: FactRow; tier: ClaimTier; outlets: string[]; independent: number }[];
  contradictionPairs: number;
  maxIndependent: number;
  scriptText: string;
}

function buildChecks(input: CheckInput): GateCheck[] {
  const { script, media, facts, contradictionPairs, maxIndependent, scriptText, episode } = input;
  const checks: GateCheck[] = [];
  const segCount = script?.segments.length ?? 0;

  /* 1. Claim backing — the single most important thing. */
  {
    const weight = 26;
    const cov = media?.coverage_pct ?? 0;
    const backed = media ? media.backing.filter((b) => b.claim_ids.length).length : 0;
    const status: CheckStatus = !facts.length ? "fail" : cov < 35 ? "fail" : cov < 60 ? "warn" : "pass";
    checks.push({
      id: "claim_backing",
      label: "Script traces to verified claims",
      status,
      weight,
      earned: facts.length ? scaled(cov, 20, 75, weight) : 0,
      measured: facts.length
        ? `${backed} of ${segCount} spoken lines match a verified claim (${pct(cov)}).`
        : "The evidence layer has no claims for this story, so no line can be traced.",
      rule: "Pass at 60% of lines or more, warn below that, fail below 35% or with no claims at all. Points scale from 20% to 75%.",
      fix:
        status === "pass"
          ? null
          : facts.length
            ? "Open the Script tab: lines with a grey evidence chip are unbacked. Either rewrite them to state what the claims actually support, or run Re-verify on the story to extract more claims."
            : "Run verification on the story page first — the dossier has nothing to check this script against.",
      target: status === "pass" ? null : { tab: "script" },
    });
  }

  /* 2. Strength of the evidence the script leans on. */
  {
    const weight = 18;
    const strong = media ? media.backing.filter((b) => b.level === "high").length : 0;
    const moderate = media ? media.backing.filter((b) => b.level === "moderate").length : 0;
    const backed = media ? media.backing.filter((b) => b.claim_ids.length).length : 0;
    const share = backed ? ((strong + moderate * 0.6) / backed) * 100 : 0;
    const status: CheckStatus = !backed ? "fail" : share < 25 ? "fail" : share < 55 ? "warn" : "pass";
    checks.push({
      id: "evidence_strength",
      label: "Backing is independent, not just present",
      status,
      weight,
      earned: backed ? scaled(share, 10, 70, weight) : 0,
      measured: backed
        ? `Of ${backed} backed lines, ${strong} rest on 3+ independent chains and ${moderate} on 2.`
        : "No backed lines to weigh.",
      rule: "Corroborated lines count 0.6, confirmed lines count 1. Pass above 55% of backed lines, fail below 25%.",
      fix:
        status === "pass"
          ? null
          : "Lean the script on the confirmed claims in the dossier and attribute the thin ones by name instead of asserting them.",
      target: status === "pass" ? null : { tab: "script" },
    });
  }

  /* 3. Contradictions must be disclosed, not smoothed over. */
  {
    const weight = 14;
    const discloses = CONTRAST_MARKERS.test(scriptText);
    const disputedSpoken = media ? media.backing.filter((b) => b.tier === "disputed").length : 0;
    const needed = contradictionPairs > 0;
    const status: CheckStatus = !needed ? "pass" : discloses ? "pass" : "fail";
    checks.push({
      id: "contradiction_disclosure",
      label: "Conflicting accounts are disclosed",
      status,
      weight,
      earned: status === "pass" ? weight : 0,
      measured: needed
        ? `The dossier holds ${contradictionPairs} contradicting claim ${contradictionPairs === 1 ? "pair" : "pairs"}; the script ${discloses ? "does" : "does not"} contain contrasting language, and speaks ${disputedSpoken} disputed ${disputedSpoken === 1 ? "line" : "lines"}.`
        : "No contradictions were detected between claims, so there is nothing to disclose.",
      rule: "When the dossier holds a contradiction, the script must contain explicit contrasting language (\"but\", \"disputes\", \"denies\", \"by contrast\"). Otherwise this fails outright.",
      fix: status === "pass" ? null : "Add a line naming both accounts — who says what, and that the two cannot both be true. The Dossier tab on the story lists the pairs.",
      target: status === "pass" ? null : { tab: "script" },
    });
  }

  /* 4. Syndication honesty — the failure the critique cares most about. */
  {
    const weight = 12;
    const claimsConsensus = CONSENSUS_CLAIMS.test(scriptText);
    const status: CheckStatus = !claimsConsensus ? "pass" : maxIndependent >= 3 ? "pass" : maxIndependent === 2 ? "warn" : "fail";
    checks.push({
      id: "syndication_honesty",
      label: "No false consensus from syndicated copy",
      status,
      weight,
      earned: status === "pass" ? weight : status === "warn" ? Math.round(weight * 0.5) : 0,
      measured: claimsConsensus
        ? `The script asserts multi-outlet agreement, and the strongest claim in the story rests on ${maxIndependent} independent reporting ${maxIndependent === 1 ? "chain" : "chains"}.`
        : "The script makes no multi-outlet consensus claim, so there is nothing to overstate.",
      rule: "Language such as \"multiple outlets confirm\" requires 3 independent chains. Two chains warn; one fails, because copies of a single wire report are not corroboration.",
      fix:
        status === "pass"
          ? null
          : "Attribute the report to the outlet that broke it — \"a Reuters report, picked up by…\" — rather than counting the outlets that reprinted it.",
      target: status === "pass" ? null : { tab: "script" },
    });
  }

  /* 5. A single-chain story must say so. */
  {
    const weight = 8;
    const thin = maxIndependent <= 1 && facts.length > 0;
    const hedged = SINGLE_SOURCE_HEDGE.test(scriptText);
    const status: CheckStatus = !thin ? "pass" : hedged ? "pass" : "warn";
    checks.push({
      id: "single_chain_flagged",
      label: "Thin sourcing is stated aloud",
      status,
      weight,
      earned: status === "pass" ? weight : Math.round(weight * 0.4),
      measured: thin
        ? `Every claim in this story comes from one reporting chain, and the script ${hedged ? "says so" : "does not say so"}.`
        : `The story carries up to ${maxIndependent} independent chains, so it does not rest on a single account.`,
      rule: "When nothing in the story is independently corroborated, the narration must contain a hedge naming that fact.",
      fix: status === "pass" ? null : "Add a sentence noting that only one outlet has reported this and it has not been independently confirmed.",
      target: status === "pass" ? null : { tab: "script" },
    });
  }

  /* 6. Audio exists and matches the script's own estimate. */
  {
    const weight = 8;
    const dur = episode.audio_duration ?? 0;
    const est = script?.estimated_seconds ?? 0;
    const drift = est > 0 && dur > 0 ? Math.abs(dur - est) / est : 1;
    const status: CheckStatus = !episode.audio_path || dur <= 0 ? "fail" : drift > 0.45 ? "warn" : "pass";
    checks.push({
      id: "audio_present",
      label: "Audio exists and runs to length",
      status,
      weight,
      earned: !episode.audio_path || dur <= 0 ? 0 : drift > 0.45 ? Math.round(weight * 0.5) : weight,
      measured:
        !episode.audio_path || dur <= 0
          ? "No audio file is attached to this episode."
          : `${dur.toFixed(1)}s of audio against a ${est}s script estimate (${pct(drift * 100)} drift).`,
      rule: "Audio must exist; drift beyond 45% of the estimate warns, because it usually means segments were dropped or truncated in synthesis.",
      fix: !episode.audio_path ? "Synthesize the audio from the Script tab." : status === "warn" ? "Re-synthesize and check for segments the voice engine skipped." : null,
      target: status === "pass" ? null : { tab: "listen" },
    });
  }

  /* 7. Measured timings, so playback highlighting is not guesswork. */
  {
    const weight = 6;
    const measured = media?.timing_measured ?? false;
    const hasAudio = !!episode.audio_path;
    const status: CheckStatus = !hasAudio ? "fail" : measured ? "pass" : "warn";
    checks.push({
      id: "timings_measured",
      label: "Playback timings are measured",
      status,
      weight,
      earned: !hasAudio ? 0 : measured ? weight : Math.round(weight * 0.4),
      measured: !hasAudio
        ? "No audio, so no timings."
        : measured
          ? "Every line is positioned from the audio that voiced it."
          : "Line positions are estimated from word counts; this audio was produced before timing capture.",
      rule: "Measured timings are required for the transcript highlight and the beat links to be exact. An estimate is allowed but flagged.",
      fix: status === "pass" ? null : "Re-synthesize the audio — synthesis now records the duration of every utterance as it is written.",
      target: status === "pass" ? null : { tab: "listen" },
    });
  }

  /* 8. Lines that fit on screen. */
  {
    const weight = 5;
    const long = (script?.segments ?? []).filter((s) => s.text.split(/\s+/).filter(Boolean).length > 26);
    const share = segCount ? (long.length / segCount) * 100 : 0;
    const status: CheckStatus = segCount === 0 ? "fail" : share > 25 ? "warn" : "pass";
    checks.push({
      id: "subtitle_fit",
      label: "Lines fit as subtitles",
      status,
      weight,
      earned: segCount === 0 ? 0 : scaled(100 - share, 60, 95, weight),
      measured: segCount ? `${long.length} of ${segCount} lines exceed 26 spoken words.` : "No script segments.",
      rule: "A subtitle over roughly 26 words cannot be read in the time it is spoken. Over a quarter of lines being long warns.",
      fix: status === "pass" ? null : `Split the long lines. ${long.length ? `Start with line ${long[0].index + 1}.` : ""}`.trim(),
      target: status === "pass" ? null : { tab: "script", segment: long[0]?.index },
    });
  }

  /* 9. Every visual says what it is. */
  {
    const weight = 3;
    const beats = media?.beats ?? [];
    const unlabelled = beats.filter((b) => b.provenance.kind === "unknown").length;
    const status: CheckStatus = !beats.length ? "warn" : unlabelled > 0 ? "warn" : "pass";
    checks.push({
      id: "visual_provenance",
      label: "Every frame declares its provenance",
      status,
      weight,
      earned: !beats.length ? 0 : beats.length === unlabelled ? 0 : scaled(((beats.length - unlabelled) / beats.length) * 100, 0, 100, weight),
      measured: beats.length
        ? `${beats.length - unlabelled} of ${beats.length} beats are labelled as source photography or AI illustration.`
        : "No video has been rendered, so there are no frames to label.",
      rule: "Every frame must be marked as a source photograph or a generated illustration, so nothing synthetic can be mistaken for documentary footage.",
      fix: !beats.length ? "Render the video to produce labelled beats." : unlabelled ? "Re-render the video; provenance is recorded at render time." : null,
      target: status === "pass" ? null : { tab: "watch" },
    });
  }

  return checks;
}

/* ------------------------------------------------------------------ *
 * Gate
 * ------------------------------------------------------------------ */

const GATE_METHOD =
  "Nine checks over stored data, each worth a fixed number of points that sum to 100. The score is that sum — not a normalised figure, and not a model's opinion of its own work. Publication requires the score to reach 72 and no check to fail outright, so a high total cannot buy its way past an undisclosed contradiction. The model's editorial critique is shown separately and never moves the score.";

export function episodeGate(episodeId: string): EpisodeGate | null {
  const ep = loadEpisode(episodeId);
  if (!ep) return null;

  let script: PodcastScript | null = null;
  try {
    script = ep.script ? (JSON.parse(ep.script) as PodcastScript) : null;
  } catch {
    script = null;
  }

  const media = episodeMedia(episodeId);
  const facts = loadFacts(ep.cluster_id);
  const contradictionPairs = countContradictionPairs(facts);
  const maxIndependent = facts.reduce((m, f) => Math.max(m, f.independent), 0);
  const scriptText = (script?.segments ?? []).map((s) => s.text).join(" ");

  const checks = buildChecks({ episode: ep, script, media, facts, contradictionPairs, maxIndependent, scriptText });
  const score = Math.round(checks.reduce((a, c) => a + c.earned, 0));
  const blocking = checks.filter((c) => c.status === "fail").map((c) => c.id);
  const verdict: EpisodeGate["verdict"] = blocking.length === 0 && score >= PUBLISH_THRESHOLD ? "publish" : "needs_review";

  const warns = checks.filter((c) => c.status === "warn").length;
  const headline =
    verdict === "publish"
      ? warns
        ? `Ready to publish, with ${warns} ${warns === 1 ? "caveat" : "caveats"}`
        : "Ready to publish"
      : blocking.length
        ? `Held: ${blocking.length} blocking ${blocking.length === 1 ? "issue" : "issues"}`
        : `Held: score ${score} is below the ${PUBLISH_THRESHOLD} threshold`;

  const summary =
    verdict === "publish"
      ? `Every blocking check passed and the itemised score reached ${score}/100.${warns ? ` ${warns} ${warns === 1 ? "check needs" : "checks need"} attention but ${warns === 1 ? "does" : "do"} not block publication.` : ""}`
      : blocking.length
        ? `${blocking.length} ${blocking.length === 1 ? "check fails" : "checks fail"} outright, so the episode is held regardless of the ${score}/100 total. Each failure below states what to do and where.`
        : `No check fails outright, but the total of ${score}/100 is under the ${PUBLISH_THRESHOLD} needed to publish. The lowest-scoring checks below are the cheapest to fix.`;

  const override = readOverride(episodeId);

  return {
    episode_id: episodeId,
    score,
    verdict,
    blocking,
    checks,
    headline,
    summary,
    method: GATE_METHOD,
    advisory: advisoryFrom(ep.evaluation),
    override,
    computed_at: Date.now(),
  };
}

function countContradictionPairs(facts: { fact: FactRow }[]): number {
  const seen = new Set<string>();
  for (const { fact } of facts) {
    const others = parseIdList(fact.contradicted_by);
    for (const o of others) {
      const key = [fact.id, o].sort().join("|");
      seen.add(key);
    }
  }
  return seen.size;
}

function parseIdList(raw: string | null): string[] {
  if (!raw) return [];
  const s = raw.trim();
  if (!s) return [];
  if (s.startsWith("[")) {
    try {
      const v = JSON.parse(s);
      return Array.isArray(v) ? v.map(String) : [String(v)];
    } catch {
      return [s];
    }
  }
  return [s];
}

function advisoryFrom(raw: string | null): GateAdvisory | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    const conf = typeof v.publish_confidence === "number" ? v.publish_confidence : typeof v.overall === "number" ? (v.overall as number) / 100 : null;
    return {
      publish_confidence: conf,
      decision: typeof v.decision === "string" ? v.decision : typeof v.verdict === "string" ? v.verdict : null,
      reasons: Array.isArray(v.reasons) ? v.reasons.map(String) : Array.isArray(v.strengths) ? (v.strengths as unknown[]).map(String) : [],
      improvements: Array.isArray(v.improvements) ? (v.improvements as unknown[]).map(String) : [],
      notes: typeof v.fact_check_notes === "string" ? v.fact_check_notes : typeof v.summary === "string" ? v.summary : "",
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Persistence
 * ------------------------------------------------------------------ */

const OVERRIDE_PREFIX = "override:";

function readOverride(episodeId: string): { at: number; note: string } | null {
  try {
    const row = getDb().prepare("SELECT verdict, reasons, decided_at FROM publish_gates WHERE episode_id=?").get(episodeId) as
      | { verdict: string; reasons: string; decided_at: number }
      | undefined;
    if (!row || row.verdict !== "published_with_override") return null;
    let note = "";
    try {
      const list = JSON.parse(row.reasons) as unknown[];
      const found = list.map(String).find((r) => r.startsWith(OVERRIDE_PREFIX));
      note = found ? found.slice(OVERRIDE_PREFIX.length).trim() : "";
    } catch {
      note = "";
    }
    return { at: row.decided_at, note };
  } catch {
    return null;
  }
}

/** Records the gate decision so the story page can show it without recomputing. */
export function persistGate(gate: EpisodeGate): void {
  try {
    getDb()
      .prepare("INSERT OR REPLACE INTO publish_gates (episode_id, score, verdict, reasons, decided_at) VALUES (?,?,?,?,?)")
      .run(
        gate.episode_id,
        gate.score / 100,
        gate.verdict,
        JSON.stringify(gate.checks.filter((c) => c.status !== "pass").map((c) => `${c.status === "fail" ? "BLOCK" : "warn"}: ${c.label} — ${c.measured}`)),
        gate.computed_at,
      );
  } catch {
    /* read-only database — the gate is still computed and returned */
  }
}

/** Records a human decision to publish over a blocked gate, with the reason given. */
export function recordOverride(episodeId: string, note: string, score: number): void {
  try {
    getDb()
      .prepare("INSERT OR REPLACE INTO publish_gates (episode_id, score, verdict, reasons, decided_at) VALUES (?,?,?,?,?)")
      .run(episodeId, score / 100, "published_with_override", JSON.stringify([`${OVERRIDE_PREFIX} ${note}`]), Date.now());
  } catch {
    /* non-fatal */
  }
}
