/**
 * Inline citation — attaching evidence to prose.
 *
 * The narrative on a story page is written by a model. Left unmarked, the reader
 * has no way to tell which sentences rest on a claim three newsrooms confirmed
 * and which are the model's own connective tissue. This module maps each sentence
 * of generated prose back to the verified claims that support it, so the interface
 * can cite the strong sentences and visibly leave the rest uncited.
 *
 * Matching is deliberately asymmetric. A claim is short ("Netanyahu rejected the
 * plan"); a narrative sentence is long and carries clauses no claim covers. So we
 * measure *containment* — how much of the claim appears in the sentence — rather
 * than Jaccard similarity, which would be diluted to nothing by the sentence's
 * extra words.
 *
 * Nothing here calls a model. Uncited sentences are shown as uncited; the honest
 * answer is that the evidence layer does not back them.
 */

import { tokenizeClaim, type ClaimTokens, type ClaimTier } from "./verification";

export interface CitableFact {
  id: string;
  claim: string;
  tier: ClaimTier;
  outlets: string[];
  independent_count: number;
  confidence: number;
}

export interface Citation {
  claim_id: string;
  claim: string;
  tier: ClaimTier;
  outlets: string[];
  independent_count: number;
  /** Containment score of the match, 0-1. Exposed so the UI can be honest. */
  match: number;
}

export interface CitedSentence {
  text: string;
  citations: Citation[];
  /** Strongest tier among the citations, or null when the sentence is uncited. */
  tier: ClaimTier | null;
  /** Distinct outlets across all citations on this sentence. */
  outlets: string[];
  /** Highest independent-chain count among the citations. */
  independent: number;
}

export interface CitedText {
  sentences: CitedSentence[];
  cited: number;
  total: number;
  /** Share of sentences backed by at least one verified claim, 0-100. */
  coverage_pct: number;
  note: string;
}

/** Above this share of a claim's tokens appearing in a sentence, we cite it. */
export const CITE_THRESHOLD = 0.55;
const MIN_SHARED_CONTENT = 2;
const MAX_CITATIONS_PER_SENTENCE = 4;

const TIER_RANK: Record<ClaimTier, number> = {
  confirmed: 4,
  corroborated: 3,
  disputed: 2,
  reported: 1,
  unverified: 0,
};

/** Abbreviations whose trailing period does not end a sentence. */
const ABBREV = /\b(?:mr|mrs|ms|dr|prof|sen|rep|gen|lt|col|sgt|st|jr|sr|vs|etc|inc|ltd|co|no|fig|approx|u\.s|u\.k|e\.g|i\.e|a\.m|p\.m)\.$/i;

/**
 * Splits prose into sentences. Handles the abbreviations that appear in news
 * copy, so "Sen. Warner said" is not cut in two and mis-cited.
 */
export function splitSentences(text: string): string[] {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const out: string[] = [];
  let buf = "";
  const parts = clean.split(/(?<=[.!?…])\s+/);
  for (const part of parts) {
    buf = buf ? `${buf} ${part}` : part;
    // Keep accumulating while the break looks like an abbreviation, an initial
    // ("J. K. Rowling"), or a fragment too short to stand alone.
    if (ABBREV.test(buf) || /\b[A-Z]\.$/.test(buf) || buf.replace(/[^a-z]/gi, "").length < 12) continue;
    out.push(buf);
    buf = "";
  }
  if (buf.trim()) {
    if (out.length && buf.replace(/[^a-z]/gi, "").length < 12) out[out.length - 1] += ` ${buf}`;
    else out.push(buf);
  }
  return out;
}

/**
 * How much of `claim` is present in `sentence`, 0-1. Content words carry most of
 * the weight; anchors (names, numbers) confirm the match is about the same thing
 * rather than merely sharing vocabulary.
 */
function containment(claim: ClaimTokens, sentence: ClaimTokens): { score: number; shared: number } {
  if (!claim.content.size) return { score: 0, shared: 0 };
  let shared = 0;
  for (const w of claim.content) if (sentence.content.has(w)) shared++;
  const content = shared / claim.content.size;
  if (!claim.anchors.size) return { score: content, shared };
  let anchorHits = 0;
  for (const a of claim.anchors) if (sentence.anchors.has(a)) anchorHits++;
  return { score: content * 0.7 + (anchorHits / claim.anchors.size) * 0.3, shared };
}

/** Attaches citations to every sentence of a passage. */
export function citeText(text: string | null | undefined, facts: CitableFact[]): CitedText {
  const sentences = splitSentences(text ?? "");
  const tokenized = facts.map((f) => ({ fact: f, tokens: tokenizeClaim(f.claim) }));

  const out: CitedSentence[] = sentences.map((s) => {
    const st = tokenizeClaim(s);
    const hits: Citation[] = [];
    for (const { fact, tokens } of tokenized) {
      const { score, shared } = containment(tokens, st);
      if (shared < MIN_SHARED_CONTENT || score < CITE_THRESHOLD) continue;
      hits.push({
        claim_id: fact.id,
        claim: fact.claim,
        tier: fact.tier,
        outlets: fact.outlets,
        independent_count: fact.independent_count,
        match: Math.round(score * 100) / 100,
      });
    }
    hits.sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier] || b.match - a.match);
    const kept = hits.slice(0, MAX_CITATIONS_PER_SENTENCE);
    const outlets = [...new Set(kept.flatMap((c) => c.outlets))];
    const best = kept.reduce<ClaimTier | null>((acc, c) => (acc === null || TIER_RANK[c.tier] > TIER_RANK[acc] ? c.tier : acc), null);
    return {
      text: s,
      citations: kept,
      tier: best,
      outlets,
      independent: kept.reduce((m, c) => Math.max(m, c.independent_count), 0),
    };
  });

  const cited = out.filter((s) => s.citations.length).length;
  return {
    sentences: out,
    cited,
    total: out.length,
    coverage_pct: out.length ? Math.round((cited / out.length) * 100) : 0,
    note:
      "Each sentence is matched against the verified claims for this story by content-word and entity containment. A sentence with no citation is not necessarily wrong — it may be context or connective phrasing — but nothing in the evidence layer backs it.",
  };
}

/**
 * Splits a forward-looking passage into its individual expectations, so each can
 * be labelled with its own confidence instead of the whole paragraph inheriting
 * one badge.
 */
export function splitForecasts(text: string | null | undefined): string[] {
  return splitSentences(text ?? "");
}
