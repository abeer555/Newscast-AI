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
import { idList, safeArray, safeParse } from "./json";
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
    const attestations = safeArray<Attestation>(fact.attestation_json);
    const outlets = [...new Set(attestations.map((a) => a.source).filter(Boolean))];
    const chains = [...new Set(attestations.map((a) => a.chain_label).filter(Boolean))];
    // Deliberately not falling back to support_count: that column counts articles,
    // and ten papers running one wire dispatch would be scored here as ten
    // independent chains — the precise overstatement this whole layer exists to stop.
    const independent = fact.independent_count ?? chains.length;
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
  return safeArray<Record<string, unknown>>(raw)
    .map((u) => ({
      start: Number(u.start) || 0,
      end: Number(u.end) || 0,
      text: String(u.text ?? ""),
      voice: String(u.voice ?? ""),
      segments: Array.isArray(u.segments) ? u.segments.map(Number).filter((n) => Number.isFinite(n)) : [],
    }))
    .filter((u) => u.end > u.start);
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

/**
 * Ordering used to pick the *most informative* citation to show first. It is not a
 * ranking of trust: `disputed` sits mid-table because a disputed claim is
 * well-attested — the outlets disagree about it — and that makes it worth surfacing
 * ahead of a single-source line. Which tier a whole segment is labelled with is
 * decided in `segmentTier`, not here, because "strongest wins" is the wrong rule
 * for a segment that carries a contradiction.
 */
const TIER_RANK: Record<ClaimTier, number> = { confirmed: 4, corroborated: 3, disputed: 2, reported: 1, unverified: 0 };

/**
 * The tier a segment is labelled with.
 *
 * A contradiction always wins. If a line carries one confirmed claim and one that
 * outlets actively dispute, calling the line "confirmed" is the exact failure the
 * evidence layer exists to prevent: the dispute disappears and the listener is told
 * the opposite of the truth about how solid the line is.
 */
function segmentTier(cited: Citation[]): ClaimTier | null {
  if (!cited.length) return null;
  if (cited.some((c) => c.tier === "disputed")) return "disputed";
  return cited.reduce<ClaimTier | null>((acc, c) => (acc === null || TIER_RANK[c.tier] > TIER_RANK[acc] ? c.tier : acc), null);
}

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

/**
 * The phrase shown under a line during playback.
 *
 * `outlets` can be 0 even when claims matched — a fact row carrying a chain count but
 * no stored attestations produces exactly that — and "0 supporting sources · High
 * confidence" is a sentence that should never reach a listener. When we cannot name
 * the outlets we report the chain count instead, and if we have neither we say so.
 */
function labelFor(level: BackingLevel, outlets: number, tier: ClaimTier | null, independent = 0): string {
  if (level === "none") return LEVEL_WORD.none;
  if (tier === "disputed") {
    return outlets > 0
      ? `${outlets} ${outlets === 1 ? "source" : "sources"} · sources conflict here`
      : "Sources conflict here";
  }
  if (outlets > 0) return `${outlets} supporting ${outlets === 1 ? "source" : "sources"} · ${LEVEL_WORD[level]}`;
  if (independent > 0) {
    return `${independent} independent reporting ${independent === 1 ? "chain" : "chains"} · ${LEVEL_WORD[level]}`;
  }
  return "Backed by a claim with no recorded outlet";
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
  const script = safeParse<PodcastScript | null>(ep.script, null);
  if (!script || !Array.isArray(script.segments)) return null;
  const segs = script.segments;
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
    const tier = segmentTier(kept);
    const outlets = [...new Set(kept.flatMap((c) => c.outlets))];
    const independent = kept.reduce((m, c) => Math.max(m, c.independent_count), 0);
    const level = levelFor(tier, independent);
    return {
      index: i,
      speaker: s.speaker,
      text: s.text,
      tier,
      level,
      label: labelFor(level, outlets.length, tier, independent),
      outlets,
      independent,
      claim_ids: kept.map((c) => c.claim_id),
      citations: kept,
      sentence_coverage: cited.coverage_pct,
    };
  });

  // Beats, with their own on-screen window and the claims their narration carries.
  let beats: BeatLink[] = [];
  const board = safeParse<{ beats?: StoredBeat[] } | null>(ep.storyboard, null);
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

/**
 * Disclosure language, split by strength.
 *
 * The word "but" alone used to satisfy a 14-point hard-fail check, which meant any
 * script containing an ordinary sentence connective was credited with disclosing a
 * contradiction it never mentioned. Only the explicit markers count as disclosure
 * now; a bare connective earns a warning, because it *might* be doing the work but
 * we cannot tell from the text.
 */
const STRONG_CONTRAST =
  /\b(disput|deni(?:es|ed|al)|contradict|conflict|unconfirmed|not (?:independently )?(?:verified|confirmed|corroborated)|reject|contest|by contrast|on the other hand|whereas|however|although|contrary to|no evidence|casts? doubt)/i;
const WEAK_CONTRAST = /\b(but|though|differ|while|instead)\b/i;
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
    const backedLines = media ? media.backing.filter((b) => b.claim_ids.length) : [];
    const backed = backedLines.length;
    // Counted from the chain numbers themselves rather than from the display level,
    // so the sentence below is literally what was measured. A disputed line is
    // excluded from both counts however well-attested it is — outlets disagreeing
    // about a claim is not the same as outlets corroborating it.
    const strong = backedLines.filter((b) => b.tier !== "disputed" && b.independent >= 3).length;
    const moderate = backedLines.filter((b) => b.tier !== "disputed" && b.independent === 2).length;
    const disputed = backedLines.filter((b) => b.tier === "disputed").length;
    const share = backed ? ((strong + moderate * 0.6) / backed) * 100 : 0;
    const status: CheckStatus = !backed ? "fail" : share < 25 ? "fail" : share < 55 ? "warn" : "pass";
    checks.push({
      id: "evidence_strength",
      label: "Backing is independent, not just present",
      status,
      weight,
      earned: backed ? scaled(share, 10, 70, weight) : 0,
      measured: backed
        ? `Of ${backed} backed lines, ${strong} rest on 3+ independent reporting chains and ${moderate} on 2${disputed ? `; ${disputed} carr${disputed === 1 ? "ies" : "y"} a disputed claim and count for nothing here` : ""}.`
        : "No backed lines to weigh.",
      rule: "A line on 2 chains counts 0.6, one on 3+ counts 1, a disputed line counts 0. Pass above 55% of backed lines, fail below 25%. Points scale from 10% to 70%, so a bare pass earns partial credit.",
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
    const strongMarker = STRONG_CONTRAST.test(scriptText);
    const weakMarker = !strongMarker && WEAK_CONTRAST.test(scriptText);
    const disputedSpoken = media ? media.backing.filter((b) => b.tier === "disputed").length : 0;
    const needed = contradictionPairs > 0;
    const status: CheckStatus = !needed ? "pass" : strongMarker ? "pass" : weakMarker ? "warn" : "fail";
    checks.push({
      id: "contradiction_disclosure",
      label: "Conflicting accounts are disclosed",
      status,
      weight,
      earned: status === "pass" ? weight : status === "warn" ? Math.round(weight * 0.4) : 0,
      measured: needed
        ? `The dossier holds ${contradictionPairs} contradicting claim ${contradictionPairs === 1 ? "pair" : "pairs"}. The script ${strongMarker ? "names the disagreement explicitly" : weakMarker ? "only contains a general connective such as “but”, which may or may not be doing that work" : "contains no contrasting language at all"}, and speaks ${disputedSpoken} disputed ${disputedSpoken === 1 ? "line" : "lines"}.`
        : "No contradictions were detected between claims, so there is nothing to disclose.",
      rule: "When the dossier holds a contradiction, the script must name it — \"disputes\", \"denies\", \"by contrast\", \"has not been confirmed\". A bare \"but\" earns partial credit only; silence fails outright.",
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
    const missing = !episode.audio_path || dur <= 0;
    // Without an estimate there is nothing to compare against. Reporting that as
    // "100% drift against a 0s script estimate" — which is what a `: 1` fallback
    // produced — states a measurement that was never taken.
    const comparable = !missing && est > 0;
    const drift = comparable ? Math.abs(dur - est) / est : 0;
    const status: CheckStatus = missing ? "fail" : !comparable ? "warn" : drift > 0.45 ? "warn" : "pass";
    checks.push({
      id: "audio_present",
      label: "Audio exists and runs to length",
      status,
      weight,
      earned: missing ? 0 : status === "warn" ? Math.round(weight * 0.5) : weight,
      measured: missing
        ? "No audio file is attached to this episode."
        : comparable
          ? `${dur.toFixed(1)}s of audio against a ${est}s script estimate (${pct(drift * 100)} drift).`
          : `${dur.toFixed(1)}s of audio, but the script carries no duration estimate, so the two cannot be compared.`,
      rule: "Audio must exist; drift beyond 45% of the estimate warns, because it usually means segments were dropped or truncated in synthesis. A missing estimate also warns — an unmeasurable check is not a passing one.",
      fix: missing
        ? "Synthesize the audio from the Script tab."
        : !comparable
          ? "Regenerate the script so it carries a duration estimate, then re-synthesize."
          : status === "warn"
            ? "Re-synthesize and check for segments the voice engine skipped."
            : null,
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
      rule: "A subtitle over roughly 26 words cannot be read in the time it is spoken. Over a quarter of lines being long warns. Points scale between 60% and 95% of lines fitting, so a script that only just passes still earns partial credit rather than the full 5.",
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
  "Nine checks over stored data, each worth a fixed number of points that sum to 100. Several award partial credit on a sliding scale, so a check can earn 4.2 of its 5 points; the headline score is the sum of those figures rounded to the nearest whole point, which is why the parts can total slightly off the whole. The score is not a normalised figure and not a model's opinion of its own work. Publication requires the score to reach 72 and no check to fail outright, so a high total cannot buy its way past an undisclosed contradiction. The model's editorial critique is shown separately and never moves the score.";

export function episodeGate(episodeId: string, precomputedMedia?: EpisodeMedia | null): EpisodeGate | null {
  const ep = loadEpisode(episodeId);
  if (!ep) return null;

  const script = safeParse<PodcastScript | null>(ep.script, null);

  // The media chain is the expensive half of this computation (it re-runs the
  // citation matcher over every line). Callers that need both — the studio's gate
  // endpoint does — pass theirs in rather than paying for it twice.
  const media = precomputedMedia !== undefined ? precomputedMedia : episodeMedia(episodeId);
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
    for (const o of idList(fact.contradicted_by)) {
      seen.add([fact.id, o].sort().join("|"));
    }
  }
  return seen.size;
}

function advisoryFrom(raw: string | null): GateAdvisory | null {
  const v = safeParse<Record<string, unknown> | null>(raw, null);
  if (!v || typeof v !== "object") return null;
  const conf = typeof v.publish_confidence === "number" ? v.publish_confidence : typeof v.overall === "number" ? (v.overall as number) / 100 : null;
  return {
    publish_confidence: conf,
    decision: typeof v.decision === "string" ? v.decision : typeof v.verdict === "string" ? v.verdict : null,
    reasons: Array.isArray(v.reasons) ? v.reasons.map(String) : Array.isArray(v.strengths) ? (v.strengths as unknown[]).map(String) : [],
    improvements: Array.isArray(v.improvements) ? (v.improvements as unknown[]).map(String) : [],
    notes: typeof v.fact_check_notes === "string" ? v.fact_check_notes : typeof v.summary === "string" ? v.summary : "",
  };
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
    const found = safeArray<unknown>(row.reasons)
      .map(String)
      .find((r) => r.startsWith(OVERRIDE_PREFIX));
    return { at: row.decided_at, note: found ? found.slice(OVERRIDE_PREFIX.length).trim() : "" };
  } catch {
    return null;
  }
}

/**
 * Records the gate decision so the story page can show it without recomputing.
 *
 * An existing override is never overwritten. The override row is the audit record of
 * a human choosing to publish something the arithmetic held, and the gate is
 * recomputed on nearly every page load — so without this guard a single visit to the
 * studio would quietly replace "a person published this over three failing checks"
 * with a fresh, unremarkable verdict.
 */
export function persistGate(gate: EpisodeGate): void {
  try {
    const db = getDb();
    const existing = db.prepare("SELECT verdict FROM publish_gates WHERE episode_id=?").get(gate.episode_id) as { verdict: string } | undefined;
    if (existing?.verdict === "published_with_override") return;
    db
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
