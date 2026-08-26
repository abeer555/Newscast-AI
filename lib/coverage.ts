/**
 * Coverage analysis — the comparative layer.
 *
 * A story page that lists ten source cards side by side tells you nothing you
 * couldn't get from a Google News tab. What a reader actually wants to know is
 * *who moved the story forward*: who published first, who added facts nobody
 * else had, who simply re-ran the wire, and what none of them covered.
 *
 * Everything here is derived from data already in the database — article
 * timestamps, bylines, body text, and the extracted claims — so no extra model
 * call is needed and every figure can be traced back to a row.
 */

import { getDb } from "./db";
import {
  ORIGINALITY_LABEL,
  analyzeIndependence,
  type ArticleLike,
  type IndependenceReport,
  type Originality,
} from "./independence";
import { evidenceStrength, type EvidenceStrength } from "./scoring";
import { claimsMatch, tokenizeClaim, type Attestation, type ClaimTokens } from "./verification";
import type { SourceFraming, StoryIntelligence } from "./intelligence";

export interface OutletCoverage {
  article_id: string;
  source_id: string;
  source: string;
  lean: string;
  url: string;
  title: string;
  published_at: number;
  /** Milliseconds after the first article in this story. */
  lag_ms: number;
  /** "First to report" or "+1h 12m after first coverage". */
  lag_label: string;
  originality: Originality;
  originality_label: string;
  chain: string;
  chain_label: string;
  /** Plain-English reason the originality call was made. */
  basis: string;
  /** How this outlet is telling it, from the editorial comparison when present. */
  angle: string | null;
  emphasis: string[];
  /** Renamed from "omits" — a gap in this outlet's coverage, not an accusation. */
  coverage_gap: string | null;
  tone: string | null;
  /** Claims this outlet carried that were found in this article set. */
  claims_carried: number;
  /** Claims only this outlet reported. */
  unique_claims: number;
  /** Claim texts unique to this outlet, for the information-delta view. */
  unique_examples: string[];
  /** Share of this outlet's claims that other outlets also carried. */
  overlap_pct: number;
  /** Claims that appear here and had not appeared in any earlier article. */
  added_first: number;
  body_chars: number;
}

export interface CoverageWave {
  kind: "incident" | "first_report" | "follow_up";
  label: string;
  at: number;
  /** Delta against the reference point above it, pre-formatted. */
  delta_label: string | null;
  source: string | null;
  detail: string;
  url?: string | null;
}

export interface CoverageAnalysis {
  outlets: OutletCoverage[];
  waves: CoverageWave[];
  /** Who published first, and how far ahead of the pack. */
  broke_first: {
    source: string;
    at: number;
    lead_label: string | null;
    chain_label: string;
  } | null;
  independence: IndependenceReport;
  evidence: EvidenceStrength;
  /** Outlets that added nothing other outlets did not already have. */
  followers: string[];
  /** Outlets that contributed at least one claim nobody else carried. */
  movers: string[];
  gaps: string[];
  /** Window between the earliest and latest article. */
  spread_label: string;
  method: string;
}

/* ------------------------------------------------------------------ *
 * Formatting
 * ------------------------------------------------------------------ */

export function formatDelta(ms: number): string {
  const abs = Math.abs(ms);
  const mins = Math.round(abs / 60_000);
  if (mins < 1) return "under a minute";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hours < 24) return rem ? `${hours}h ${rem}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const hrem = hours % 24;
  return hrem ? `${days}d ${hrem}h` : `${days}d`;
}

/* ------------------------------------------------------------------ *
 * Claim attribution
 * ------------------------------------------------------------------ */

interface ClaimRow {
  id: string;
  claim: string;
  attestation_json: string;
}

interface ArticleRow extends ArticleLike {
  url: string;
  content: string | null;
}

/**
 * Maps each article to the claims attested to it, using the stored attestations
 * rather than re-running extraction. Falls back to matching the claim text
 * against the article body when attestations predate the current schema.
 */
function claimsByArticle(
  claims: ClaimRow[],
  articles: ArticleRow[],
): { perArticle: Map<string, string[]>; outletsPerClaim: Map<string, Set<string>> } {
  const perArticle = new Map<string, string[]>();
  const outletsPerClaim = new Map<string, Set<string>>();
  const byId = new Map(articles.map((a) => [a.id, a]));

  let matchedAny = false;
  for (const c of claims) {
    let atts: Attestation[] = [];
    try {
      atts = JSON.parse(c.attestation_json) as Attestation[];
    } catch {
      atts = [];
    }
    const outlets = outletsPerClaim.get(c.id) ?? new Set<string>();
    for (const a of atts) {
      if (!a.article_id || !byId.has(a.article_id)) continue;
      matchedAny = true;
      const list = perArticle.get(a.article_id) ?? [];
      list.push(c.id);
      perArticle.set(a.article_id, list);
      outlets.add(byId.get(a.article_id)!.source_id);
    }
    outletsPerClaim.set(c.id, outlets);
  }

  // Older attestation rows carry only an outlet name. Recover article-level
  // attribution by looking for the claim's distinctive words in each body.
  if (!matchedAny && claims.length) {
    const tokenCache = new Map<string, ClaimTokens>();
    for (const c of claims) tokenCache.set(c.id, tokenizeClaim(c.claim));
    for (const art of articles) {
      const body = `${art.title ?? ""} ${art.summary ?? ""} ${art.content ?? ""}`;
      const bodyTokens = tokenizeClaim(body);
      for (const c of claims) {
        const t = tokenCache.get(c.id)!;
        if (!t.content.size) continue;
        let shared = 0;
        for (const w of t.content) if (bodyTokens.content.has(w)) shared++;
        if (shared / t.content.size < 0.7) continue;
        const list = perArticle.get(art.id) ?? [];
        list.push(c.id);
        perArticle.set(art.id, list);
        outletsPerClaim.get(c.id)!.add(art.source_id);
      }
    }
  }

  return { perArticle, outletsPerClaim };
}

/* ------------------------------------------------------------------ *
 * Main entry
 * ------------------------------------------------------------------ */

export function analyzeCoverage(clusterId: string, intel?: StoryIntelligence | null): CoverageAnalysis {
  const db = getDb();

  const articles = db
    .prepare(
      `SELECT a.id, a.source_id, s.name AS source_name, s.lean, a.author, a.published_at,
              a.title, a.summary, a.content, a.url
       FROM cluster_articles ca
       JOIN articles a ON a.id = ca.article_id
       JOIN sources s ON s.id = a.source_id
       WHERE ca.cluster_id = ?
       ORDER BY a.published_at ASC`,
    )
    .all(clusterId) as ArticleRow[];

  const indep = analyzeIndependence(articles);
  const provByArticle = new Map(indep.articles.map((p) => [p.article_id, p]));

  const claims = db
    .prepare("SELECT id, claim, attestation_json FROM cluster_facts WHERE cluster_id=?")
    .all(clusterId) as ClaimRow[];
  const { perArticle, outletsPerClaim } = claimsByArticle(claims, articles);
  const claimText = new Map(claims.map((c) => [c.id, c.claim]));

  // Framing notes, keyed loosely so "BBC" matches "BBC News".
  const framingIndex = new Map<string, SourceFraming>();
  for (const f of intel?.framing ?? []) {
    framingIndex.set(f.source.toLowerCase().trim(), f);
  }
  const framingFor = (name: string): SourceFraming | null => {
    const key = name.toLowerCase().trim();
    const exact = framingIndex.get(key);
    if (exact) return exact;
    for (const [k, v] of framingIndex) {
      if (k.includes(key) || key.includes(k)) return v;
    }
    return null;
  };

  const firstAt = articles.length ? articles[0].published_at : Date.now();
  const seenClaims = new Set<string>();
  const outlets: OutletCoverage[] = [];

  for (const [idx, art] of articles.entries()) {
    const prov = provByArticle.get(art.id);
    const carried = perArticle.get(art.id) ?? [];
    let unique = 0;
    let addedFirst = 0;
    const uniqueExamples: string[] = [];
    for (const cid of carried) {
      const outletSet = outletsPerClaim.get(cid);
      if (outletSet && outletSet.size === 1) {
        unique++;
        if (uniqueExamples.length < 3) uniqueExamples.push(claimText.get(cid) ?? "");
      }
      if (!seenClaims.has(cid)) {
        addedFirst++;
        seenClaims.add(cid);
      }
    }
    const framing = framingFor(art.source_name);
    const lag = art.published_at - firstAt;
    const originality = prov?.originality ?? "unattributed";

    outlets.push({
      article_id: art.id,
      source_id: art.source_id,
      source: art.source_name,
      lean: art.lean ?? "center",
      url: art.url,
      title: art.title ?? "",
      published_at: art.published_at,
      lag_ms: lag,
      // Only the genuinely earliest article gets the credit; a second story
      // filed thirty seconds later is a follow-up, not a co-scoop.
      lag_label: idx === 0 ? "First to report" : `+${formatDelta(lag)} after first coverage`,
      originality,
      originality_label: ORIGINALITY_LABEL[originality],
      chain: prov?.chain ?? `outlet:${art.source_id}`,
      chain_label: prov?.chain_label ?? art.source_name,
      basis: prov?.basis ?? "No byline in the feed; provenance unstated.",
      angle: framing?.framing ?? null,
      emphasis: framing?.emphasis ?? [],
      coverage_gap: framing?.omits ?? null,
      tone: framing?.tone ?? null,
      claims_carried: carried.length,
      unique_claims: unique,
      unique_examples: uniqueExamples.filter(Boolean),
      overlap_pct: carried.length ? Math.round(((carried.length - unique) / carried.length) * 100) : 0,
      added_first: addedFirst,
      body_chars: (art.content || art.summary || "").length,
    });
  }

  /* ---- timeline waves ---- */

  const waves: CoverageWave[] = [];
  const incidentAt = earliestIncident(intel, firstAt);
  if (incidentAt !== null && incidentAt < firstAt - 60_000) {
    waves.push({
      kind: "incident",
      label: "Event occurred",
      at: incidentAt,
      delta_label: null,
      source: null,
      detail: intel?.timeline?.[0]?.event ?? "Earliest dated event in the reconstructed timeline.",
    });
  }
  if (articles.length) {
    const lead = outlets[0];
    waves.push({
      kind: "first_report",
      label: "First coverage",
      at: lead.published_at,
      delta_label:
        incidentAt !== null && incidentAt < lead.published_at - 60_000
          ? `${formatDelta(lead.published_at - incidentAt)} after the event`
          : null,
      source: lead.source,
      detail: lead.title,
      url: lead.url,
    });
    for (const o of outlets.slice(1)) {
      waves.push({
        kind: "follow_up",
        label: o.source,
        at: o.published_at,
        delta_label: `+${formatDelta(o.lag_ms)} after first coverage`,
        source: o.source,
        detail: o.title,
        url: o.url,
      });
    }
  }

  /* ---- gaps ---- */

  // Deduped by claim text: an outlet that filed two stories carrying the same
  // exclusive should not appear twice.
  const gaps: string[] = [];
  const seenGap = new Set<string>();
  const pushGap = (line: string) => {
    const key = line.toLowerCase().slice(0, 80);
    if (seenGap.has(key)) return;
    seenGap.add(key);
    gaps.push(line);
  };
  for (const o of outlets) {
    if (o.unique_claims > 0 && o.unique_examples.length) {
      pushGap(`Only ${o.source} reports: ${o.unique_examples[0]}`);
    }
  }
  for (const o of outlets) {
    if (o.coverage_gap && o.coverage_gap.length > 8) {
      pushGap(`${o.source} leaves out: ${o.coverage_gap}`);
    }
  }

  // Aggregated per outlet, not per article: an outlet with two stories where one
  // broke news is a mover, not a follower.
  const addedByOutlet = new Map<string, number>();
  const uniqueByOutlet = new Map<string, number>();
  for (const o of outlets) {
    addedByOutlet.set(o.source, (addedByOutlet.get(o.source) ?? 0) + o.added_first);
    uniqueByOutlet.set(o.source, (uniqueByOutlet.get(o.source) ?? 0) + o.unique_claims);
  }
  const movers = [...uniqueByOutlet].filter(([, n]) => n > 0).map(([s]) => s);
  const followers = [...addedByOutlet]
    .filter(([s, n]) => n === 0 && s !== outlets[0]?.source)
    .map(([s]) => s);

  const spread = articles.length > 1 ? articles[articles.length - 1].published_at - firstAt : 0;
  const lead = outlets[0];
  const nextChain = outlets.find((o) => o.chain !== lead?.chain);

  return {
    outlets,
    waves,
    broke_first: lead
      ? {
          source: lead.source,
          at: lead.published_at,
          lead_label: nextChain ? `${formatDelta(nextChain.published_at - lead.published_at)} ahead of the next independent chain` : null,
          chain_label: lead.chain_label,
        }
      : null,
    independence: indep,
    evidence: evidenceStrength({
      outlets: indep.outlets,
      independent: indep.independent,
      attributed: indep.attributed,
    }),
    followers: [...new Set(followers)],
    movers: [...new Set(movers)],
    gaps: gaps.slice(0, 8),    spread_label: spread ? formatDelta(spread) : "single report",
    method:
      "Publication order comes from each article's feed timestamp. Originality is decided by byline attribution and body-text duplication, not by outlet reputation. Unique-claim counts compare the claims extracted from each article against every other article in this story.",
  };
}

/** Earliest parseable ISO timestamp in the model-reconstructed timeline. */
function earliestIncident(intel: StoryIntelligence | null | undefined, firstAt: number): number | null {
  let best: number | null = null;
  for (const e of intel?.timeline ?? []) {
    const t = Date.parse(e.time);
    if (Number.isNaN(t)) continue; // relative labels like "Tuesday morning"
    // Guard against hallucinated dates far outside the coverage window.
    if (t > firstAt + 3 * 86_400_000 || t < firstAt - 30 * 86_400_000) continue;
    if (best === null || t < best) best = t;
  }
  return best;
}

/**
 * A compact per-claim source matrix: which outlets carried each claim. Powers
 * the "who is saying this" grid in the dossier without a second query.
 */
export function claimSourceMatrix(clusterId: string): { claim_id: string; claim: string; outlets: string[] }[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT id, claim, attestation_json, confidence FROM cluster_facts WHERE cluster_id=? ORDER BY confidence DESC")
    .all(clusterId) as { id: string; claim: string; attestation_json: string }[];
  return rows.map((r) => {
    let outlets: string[] = [];
    try {
      outlets = [...new Set((JSON.parse(r.attestation_json) as Attestation[]).map((a) => a.source).filter(Boolean))];
    } catch {
      outlets = [];
    }
    return { claim_id: r.id, claim: r.claim, outlets };
  });
}

/** Re-exported so callers can reuse the matcher without importing verification. */
export { claimsMatch, tokenizeClaim };
