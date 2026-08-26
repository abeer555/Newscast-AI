/**
 * Verification layer — claim-level fact checking against independent sources.
 *
 * Pipeline per story:
 *   1. Extract atomic claims from every article (model call, ~3-8 per article).
 *   2. Group claims that assert the same proposition, across outlets, even when
 *      worded differently.
 *   3. Attribute each group to independent reporting chains (see ./independence),
 *      so ten papers running one AP dispatch counts once.
 *   4. Assign a confidence tier with a written justification.
 *   5. Detect genuine contradictions — opposite polarity on the same
 *      proposition, or conflicting figures for the same quantity.
 *
 * Design note on step 2: the previous implementation hashed 5-character
 * shingles, kept the 12 smallest, and required the resulting signature to match
 * *exactly* before two claims were considered the same. Exact equality of a
 * min-hash signature is a near-impossible bar, so paraphrases never grouped:
 * across the whole database 245 of 246 claims ended up single-source and every
 * one was labelled "reported". Grouping now uses word-level similarity with
 * entity and number anchors, which is what makes "confirmed by 3 independent
 * sources" a statement about the world rather than about a hash collision.
 */
import crypto from "crypto";
import { getDb } from "./db";
import { chatJson, LLM_MODELS } from "./chat";
import { analyzeIndependence, type ArticleProvenance, type Originality } from "./independence";

export interface ArticleClaim {
  article_id: string;
  source: string;
  source_id: string;
  source_url: string;
  headline: string;
  snippet: string;
  published_at: number;
  author: string | null;
  lean: string | null;
}

export interface ExtractedClaims {
  article_id: string;
  claims: { text: string; topic: string }[];
}

export type ClaimTier = "confirmed" | "corroborated" | "reported" | "disputed" | "unverified";

export interface Attestation {
  article_id: string;
  source: string;
  source_id: string;
  url: string;
  published_at: number;
  /** Independent reporting chain this attestation belongs to. */
  chain: string;
  chain_label: string;
  originality: Originality;
  /** How this outlet worded the claim — powers the information-delta view. */
  text: string;
}

export interface VerifiedFact {
  id: string;
  cluster_id: string;
  claim: string;
  claim_hash: string;
  /** Legacy column, kept in sync with `tier` for older readers. */
  status: "confirmed" | "reported" | "disputed" | "retracted";
  tier: ClaimTier;
  tier_reason: string;
  support_count: number;
  outlet_count: number;
  independent_count: number;
  attestation_json: string;
  canonical_origins: string;
  contradicted_by: string | null;
  confidence: number;
  topic: string;
  first_reported_by: string | null;
  first_reported_at: number | null;
  variants_json: string;
  first_seen: number;
  last_seen: number;
}

/* ------------------------------------------------------------------ *
 * 1. Claim extraction
 * ------------------------------------------------------------------ */

export async function extractClaims(article: ArticleClaim): Promise<ExtractedClaims> {
  const { data } = await chatJson<{ claims: { text: string; topic: string }[] }>({
    model: LLM_MODELS.heavy,
    system:
      "You are a fact-check editor. Given one news article, extract atomic claims: each is a single verifiable proposition about the world (who did what, when, where). Strip attribution verbs ('Al Jazeera reported') from the claim itself — record those in the source field. Keep specific figures, names and places in the claim text, since those are what make a claim checkable. Maximum 8 claims per article. Topic from: military|diplomacy|legal|economic|humanitarian|disaster|casualty|other.",
    user: `SOURCE: ${article.source}
HEADLINE: ${article.headline}
CONTENT: ${article.snippet.slice(0, 1600)}

Return JSON: {"claims":[{"text":"Netanyahu rejected the plan","topic":"diplomacy"}]}.`,
    jsonObject: true,
    temperature: 0.2,
    maxTokens: 2500,
    task: "claim_extract",
  });
  const claims = Array.isArray(data?.claims) ? data.claims : [];
  return {
    article_id: article.article_id,
    claims: claims.filter((c) => c && typeof c.text === "string" && c.text.trim().length > 8).slice(0, 8),
  };
}

/* ------------------------------------------------------------------ *
 * 2. Claim similarity + grouping
 * ------------------------------------------------------------------ */

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "at", "for", "with", "by", "from", "as", "is", "are",
  "was", "were", "be", "been", "being", "that", "this", "these", "those", "it", "its", "has", "have", "had", "will",
  "would", "could", "should", "may", "might", "can", "said", "says", "say", "after", "before", "over", "into", "than",
  "then", "there", "their", "they", "he", "she", "his", "her", "who", "which", "what", "when", "where", "while",
  "also", "more", "most", "other", "some", "such", "about", "against", "between", "during", "under", "out", "up",
]);

/** Words that flip a claim's polarity. Kept separate from content tokens. */
const NEGATORS = new Set([
  "not", "no", "never", "none", "cannot", "cant", "didnt", "doesnt", "isnt", "wasnt", "wont", "denied", "denies",
  "deny", "rejected", "rejects", "reject", "refuted", "refutes", "disputed", "disputes", "false", "falsely",
  "without", "failed", "halted", "withdrew", "unfounded", "baseless", "dismissed",
]);

/** Very light stemmer — enough to make "kills"/"killed"/"killing" match. */
function stem(w: string): string {
  if (w.length <= 4) return w;
  for (const suf of ["ational", "iveness", "ization", "ations", "ingly", "edly", "ings", "ing", "ies", "ied", "ed", "es", "s"]) {
    if (w.endsWith(suf) && w.length - suf.length >= 3) return w.slice(0, w.length - suf.length);
  }
  return w;
}

export interface ClaimTokens {
  /** Content words, stemmed and stopword-filtered. */
  content: Set<string>;
  /** Numbers and capitalised entities — the parts that make claims checkable. */
  anchors: Set<string>;
  /**
   * Quantities keyed by what they measure, e.g. "killed" -> 12. Keyed by
   * predicate family where one is present, so "12 killed" and "75 injured" are
   * recognised as measuring different things rather than disagreeing about one.
   */
  quantities: Map<string, number>;
  /** Predicate families present in the claim (killed, injured, arrested...). */
  families: Set<string>;
  negated: boolean;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, dozen: 12, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100, thousand: 1000,
};

/**
 * Measurable outcomes that news reports quantify. Two claims counting different
 * families are about different things — the distinction between "12 killed" and
 * "75 injured" is exactly the kind of thing a naive grouper collapses and then
 * reports as a contradiction.
 */
const FAMILIES: { key: string; words: string[] }[] = [
  { key: "killed", words: ["kill", "dead", "death", "die", "fatal", "fatalit", "perish", "slain"] },
  { key: "injured", words: ["injur", "wound", "hurt", "hospitalis", "hospitaliz", "casualt"] },
  { key: "missing", words: ["miss", "unaccount"] },
  { key: "arrested", words: ["arrest", "detain", "custod"] },
  { key: "displaced", words: ["displac", "evacuat", "flee", "fled", "refuge"] },
  { key: "damaged", words: ["damag", "destroy", "burn", "collaps"] },
];

/** Contrastive negation — "genuine, not fictitious" narrows a claim, it does not deny one. */
const CONTRASTIVE_LEADS = new Set(["but", "rather", "instead", "although", "though", "whereas", "while"]);

export function tokenizeClaim(text: string): ClaimTokens {
  const raw = text.split(/\s+/).filter(Boolean);
  const content = new Set<string>();
  const anchors = new Set<string>();
  const quantities = new Map<string, number>();
  const families = new Set<string>();
  let negated = false;

  const cleaned: { word: string; num: number | null }[] = [];
  for (let i = 0; i < raw.length; i++) {
    const original = raw[i];
    const word = original.toLowerCase().replace(/[^a-z0-9.%-]/g, "");
    if (!word) continue;
    const bare = word.replace(/[^a-z]/g, "");
    if (NEGATORS.has(bare)) {
      // Ignore negators in a contrastive construction: "X, not Y" and
      // "not X but Y" restrict a claim rather than reversing it.
      const prev = raw[i - 1] ?? "";
      const contrastive = /[,;:]$/.test(prev) || CONTRASTIVE_LEADS.has(prev.toLowerCase().replace(/[^a-z]/g, ""));
      if (!contrastive) negated = !negated;
      continue;
    }
    // Capitalised mid-sentence words are proper nouns — strong anchors.
    if (i > 0 && /^[A-Z][a-z]{2,}/.test(original.replace(/[^A-Za-z]/g, ""))) {
      anchors.add(stem(bare));
    }
    const numeric = word.replace(/[,%]/g, "");
    const asNum = /^\d+(\.\d+)?$/.test(numeric) ? parseFloat(numeric) : (NUMBER_WORDS[word] ?? null);
    if (asNum !== null) {
      anchors.add(`#${asNum}`);
      cleaned.push({ word, num: asNum });
      continue;
    }
    if (STOPWORDS.has(word)) {
      cleaned.push({ word, num: null });
      continue;
    }
    const s = stem(bare);
    if (s.length > 2) content.add(s);
    for (const f of FAMILIES) if (f.words.some((w) => s.startsWith(w) || w.startsWith(s))) families.add(f.key);
    cleaned.push({ word: s, num: null });
  }

  // Attribute each number to a predicate family where the claim has one
  // ("killed at least 12 people" -> killed:12), otherwise to the nearest noun.
  for (let i = 0; i < cleaned.length; i++) {
    const n = cleaned[i].num;
    if (n === null) continue;
    let key: string | null = null;
    for (let j = Math.max(0, i - 4); j < Math.min(cleaned.length, i + 5) && !key; j++) {
      if (j === i) continue;
      const w = cleaned[j].word;
      const fam = FAMILIES.find((f) => f.words.some((x) => w.startsWith(x) || x.startsWith(w)));
      if (fam) key = fam.key;
    }
    if (!key) {
      for (let j = i + 1; j < Math.min(cleaned.length, i + 4); j++) {
        const w = cleaned[j].word;
        if (cleaned[j].num !== null || STOPWORDS.has(w) || w.length < 3) continue;
        key = w;
        break;
      }
    }
    if (key && !quantities.has(key)) quantities.set(key, n);
  }

  return { content, anchors, quantities, families, negated };
}

function jaccardSet(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

function overlapCount(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
}

/**
 * Similarity between two claims, ignoring polarity. Content overlap carries most
 * of the weight; shared anchors (names, numbers) act as confirmation that two
 * similarly-worded claims are actually about the same event.
 */
export function claimSimilarity(a: ClaimTokens, b: ClaimTokens): number {
  const content = jaccardSet(a.content, b.content);
  const anchorUnion = new Set([...a.anchors, ...b.anchors]).size;
  const anchor = anchorUnion ? overlapCount(a.anchors, b.anchors) / anchorUnion : 0;
  const hasAnchors = a.anchors.size > 0 && b.anchors.size > 0;
  return hasAnchors ? content * 0.65 + anchor * 0.35 : content;
}

/** Above this, two claims are treated as the same proposition. */
export const CLAIM_MATCH_THRESHOLD = 0.42;
/** Minimum shared content words, so short claims can't match on one token. */
const MIN_SHARED_CONTENT = 2;

export function claimsMatch(a: ClaimTokens, b: ClaimTokens): boolean {
  if (overlapCount(a.content, b.content) < MIN_SHARED_CONTENT) return false;
  // Claims counting different outcomes are different claims, however similar
  // their wording: "12 killed" and "75 injured" describe the same incident but
  // assert different facts.
  if (a.families.size && b.families.size && overlapCount(a.families, b.families) === 0) return false;
  return claimSimilarity(a, b) >= CLAIM_MATCH_THRESHOLD;
}

/**
 * Stable dedupe key for a grouped claim. Derived from the sorted content tokens
 * and anchors, so the same proposition produces the same key across runs even if
 * a different outlet's phrasing becomes the representative text.
 */
export function claimHash(text: string): string {
  const t = tokenizeClaim(text);
  const basis = [...t.content].sort().join(" ") + "|" + [...t.anchors].sort().join(" ");
  return crypto.createHash("sha1").update(basis).digest("hex").slice(0, 24);
}

/* ------------------------------------------------------------------ *
 * 3-4. Attestation and tiering
 * ------------------------------------------------------------------ */

interface ClaimWithOrigin {
  text: string;
  topic: string;
  origin: ArticleClaim;
  tokens: ClaimTokens;
}

interface ClaimGroup {
  members: ClaimWithOrigin[];
  /** The founding claim's tokens. New members are matched against this. */
  seed: ClaimTokens;
}

function groupClaims(flat: ClaimWithOrigin[]): ClaimGroup[] {
  const groups: ClaimGroup[] = [];
  // Claim counts per story are small (articles x <=8), so an exhaustive pass is
  // both cheaper and more accurate than LSH bucketing here.
  //
  // Candidates are matched against each group's founding claim rather than the
  // union of its members. Unioning tokens lets a group's profile drift outwards
  // with every addition until it starts absorbing merely adjacent claims —
  // during testing that pulled a Hamas-official quote into a group of Netanyahu
  // statements. Anchoring on the seed keeps groups tight.
  for (const c of flat) {
    let best: { g: ClaimGroup; sim: number } | null = null;
    for (const g of groups) {
      if (!claimsMatch(c.tokens, g.seed)) continue;
      const sim = claimSimilarity(c.tokens, g.seed);
      if (!best || sim > best.sim) best = { g, sim };
    }
    if (best) best.g.members.push(c);
    else groups.push({ members: [c], seed: c.tokens });
  }
  return groups;
}

/** Picks the phrasing that best represents a group: most specific, then earliest. */
function representative(members: ClaimWithOrigin[]): ClaimWithOrigin {
  return [...members].sort((a, b) => {
    const spec = b.tokens.anchors.size - a.tokens.anchors.size;
    if (spec !== 0) return spec;
    const len = b.text.length - a.text.length;
    if (Math.abs(len) > 40) return len;
    return a.origin.published_at - b.origin.published_at;
  })[0];
}

export function tierFor(args: { independent: number; outlets: number; contradicted: boolean }): { tier: ClaimTier; reason: string } {
  if (args.contradicted) {
    return {
      tier: "disputed",
      reason: "Another outlet in this story asserts the opposite, or gives a conflicting figure. Both versions are shown rather than one being picked.",
    };
  }
  if (args.independent >= 3) {
    return {
      tier: "confirmed",
      reason: `Reported independently by ${args.independent} separate reporting chains, so it does not rest on any single newsroom's account.`,
    };
  }
  if (args.independent === 2) {
    return {
      tier: "corroborated",
      reason: "Two independent newsrooms report this. Corroborated, but one short of the three-chain bar for confirmation.",
    };
  }
  if (args.independent === 1) {
    const extra =
      args.outlets > 1
        ? ` ${args.outlets} outlets carry it, but they trace to one original report, so the extra outlets add reach rather than evidence.`
        : "";
    return { tier: "reported", reason: `Single reporting chain.${extra}` };
  }
  return { tier: "unverified", reason: "No attributable reporting chain could be established for this claim." };
}

const LEGACY_STATUS: Record<ClaimTier, VerifiedFact["status"]> = {
  confirmed: "confirmed",
  corroborated: "reported",
  reported: "reported",
  disputed: "disputed",
  unverified: "reported",
};

/**
 * Confidence, per the documented formula:
 *   min(0.99, 0.35 * independent_chains + 0.25 * ln(attesting_articles + 1))
 * Independence dominates; volume contributes with diminishing returns so a
 * flood of syndicated copies cannot push a single-source claim to high
 * confidence.
 */
export function claimConfidence(independent: number, support: number): number {
  return Math.round(Math.min(0.99, independent * 0.35 + Math.log(support + 1) * 0.25) * 100) / 100;
}

export const CONFIDENCE_METHOD =
  "confidence = min(0.99, 0.35 x independent reporting chains + 0.25 x ln(attesting articles + 1)). Independence dominates deliberately: extra syndicated copies of one dispatch raise reach, not confidence.";

export const TIER_METHOD: Record<ClaimTier, string> = {
  confirmed: "Three or more independent reporting chains assert this.",
  corroborated: "Two independent reporting chains assert this.",
  reported: "One reporting chain. Not yet independently corroborated.",
  disputed: "Outlets disagree — opposite polarity or conflicting figures for the same quantity.",
  unverified: "No reporting chain could be attributed.",
};

/* ------------------------------------------------------------------ */

export async function attestClaims(clusterId: string): Promise<VerifiedFact[]> {
  const db = getDb();
  const articles = db
    .prepare(
      `SELECT a.id AS article_id, a.title AS headline, COALESCE(a.content, a.summary, '') AS snippet, a.published_at,
              a.url AS source_url, a.author, s.name AS source, s.id AS source_id, s.lean
       FROM cluster_articles ca JOIN articles a ON a.id=ca.article_id JOIN sources s ON s.id=a.source_id
       WHERE ca.cluster_id=? ORDER BY a.published_at ASC`,
    )
    .all(clusterId) as ArticleClaim[];
  if (!articles.length) return [];

  // Provenance first: grouping claims is only meaningful once we know which
  // outlets are genuinely separate reporting chains.
  const indep = analyzeIndependence(
    articles.map((a) => ({
      id: a.article_id,
      source_id: a.source_id,
      source_name: a.source,
      lean: a.lean,
      author: a.author,
      published_at: a.published_at,
      title: a.headline,
      summary: a.snippet,
    })),
  );
  const provByArticle = new Map<string, ArticleProvenance>(indep.articles.map((p) => [p.article_id, p]));

  const extracted = await Promise.all(
    articles.map((a) =>
      extractClaims(a).catch((e) => {
        console.warn(`[attestClaims] extraction failed for ${a.source}: ${e}`);
        return { article_id: a.article_id, claims: [] } satisfies ExtractedClaims;
      }),
    ),
  );

  const flat: ClaimWithOrigin[] = [];
  for (const ex of extracted) {
    const origin = articles.find((a) => a.article_id === ex.article_id);
    if (!origin) continue;
    for (const c of ex.claims) {
      flat.push({ text: c.text.trim(), topic: c.topic || "other", origin, tokens: tokenizeClaim(c.text) });
    }
  }
  if (!flat.length) return [];

  const groups = groupClaims(flat);
  const now = Date.now();

  const upsert = db.prepare(
    `INSERT INTO cluster_facts
       (id, cluster_id, claim, claim_hash, status, tier, tier_reason, support_count, outlet_count, independent_count,
        attestation_json, canonical_origins, confidence, topic, first_reported_by, first_reported_at, variants_json,
        first_seen, last_seen)
     VALUES (@id,@cluster_id,@claim,@claim_hash,@status,@tier,@tier_reason,@support_count,@outlet_count,@independent_count,
             @attestation_json,@canonical_origins,@confidence,@topic,@first_reported_by,@first_reported_at,@variants_json,
             @first_seen,@last_seen)
     ON CONFLICT(cluster_id, claim_hash) DO UPDATE SET
       claim=excluded.claim, status=excluded.status, tier=excluded.tier, tier_reason=excluded.tier_reason,
       support_count=excluded.support_count, outlet_count=excluded.outlet_count,
       independent_count=excluded.independent_count, attestation_json=excluded.attestation_json,
       canonical_origins=excluded.canonical_origins, confidence=excluded.confidence, topic=excluded.topic,
       first_reported_by=excluded.first_reported_by, first_reported_at=excluded.first_reported_at,
       variants_json=excluded.variants_json, last_seen=excluded.last_seen`,
  );
  const existingIds = db.prepare("SELECT id, claim_hash FROM cluster_facts WHERE cluster_id=?").all(clusterId) as {
    id: string;
    claim_hash: string;
  }[];
  const idByHash = new Map(existingIds.map((r) => [r.claim_hash, r.id]));

  const facts: VerifiedFact[] = [];
  const rows: Record<string, unknown>[] = [];

  for (const g of groups) {
    const main = representative(g.members);
    const chash = claimHash(main.text);

    // One attestation per (article) but independence measured per chain.
    const seenArticles = new Set<string>();
    const attestations: Attestation[] = [];
    for (const m of g.members) {
      if (seenArticles.has(m.origin.article_id)) continue;
      seenArticles.add(m.origin.article_id);
      const p = provByArticle.get(m.origin.article_id);
      attestations.push({
        article_id: m.origin.article_id,
        source: m.origin.source,
        source_id: m.origin.source_id,
        url: m.origin.source_url,
        published_at: m.origin.published_at,
        chain: p?.chain ?? `outlet:${m.origin.source_id}`,
        chain_label: p?.chain_label ?? m.origin.source,
        originality: p?.originality ?? "unattributed",
        text: m.text,
      });
    }
    attestations.sort((a, b) => a.published_at - b.published_at);

    const chains = new Set(attestations.map((a) => a.chain));
    const outlets = new Set(attestations.map((a) => a.source_id));
    const independent = chains.size;
    const { tier, reason } = tierFor({ independent, outlets: outlets.size, contradicted: false });
    const confidence = claimConfidence(independent, attestations.length);

    // Distinct phrasings, one per chain — this is what "NPR said 8, DW said 10"
    // is built from downstream.
    const variants = [...new Map(attestations.map((a) => [a.chain, { source: a.source, chain: a.chain_label, text: a.text }])).values()];

    const id = idByHash.get(chash) ?? crypto.randomBytes(6).toString("hex");
    const first = attestations[0];
    const row = {
      id,
      cluster_id: clusterId,
      claim: main.text,
      claim_hash: chash,
      status: LEGACY_STATUS[tier],
      tier,
      tier_reason: reason,
      support_count: attestations.length,
      outlet_count: outlets.size,
      independent_count: independent,
      attestation_json: JSON.stringify(attestations),
      canonical_origins: JSON.stringify([...new Set(attestations.map((a) => a.chain_label))]),
      confidence,
      topic: main.topic,
      first_reported_by: first?.source ?? null,
      first_reported_at: first?.published_at ?? null,
      variants_json: JSON.stringify(variants),
      first_seen: now,
      last_seen: now,
    };
    rows.push(row);
    facts.push({ ...(row as unknown as VerifiedFact), contradicted_by: null });
  }

  const tx = db.transaction(() => {
    for (const r of rows) upsert.run(r);
    // Drop claims from earlier runs that no longer appear, so the dossier
    // reflects the current article set rather than accumulating forever.
    db.prepare("DELETE FROM cluster_facts WHERE cluster_id=? AND last_seen < ?").run(clusterId, now);
  });
  tx();

  return facts;
}

/* ------------------------------------------------------------------ *
 * 5. Contradiction detection
 * ------------------------------------------------------------------ */

export interface Contradiction {
  a: string;
  b: string;
  kind: "polarity" | "quantity";
  uncertainty: string;
  detail: string;
}

/**
 * Finds real disagreements rather than lexical coincidences.
 *
 * The old check flagged a pair whenever one claim contained the substring "not "
 * and the other contained "will " — with only a three-word overlap guard. On the
 * live database that produced 31 "contradictions", essentially all of them
 * between near-duplicate claims. Two stricter tests replace it:
 *
 *   polarity — strip negators from both claims; if what remains is highly
 *     similar but their negation parity differs, they genuinely conflict.
 *   quantity — both claims quantify the same noun ("fatalities", "arrests") but
 *     give materially different figures.
 */
export function detectContradictions(facts: VerifiedFact[]): Contradiction[] {
  const out: Contradiction[] = [];
  const db = getDb();
  const tokens = new Map<string, ClaimTokens>(facts.map((f) => [f.id, tokenizeClaim(f.claim)]));
  const contradicted = new Map<string, string[]>();

  /**
   * Polarity needs a high bar. A negator can attach to a sub-clause rather than
   * the main proposition, so two claims can differ in parity while agreeing
   * completely. Requiring near-identical wording either side of the negation is
   * what separates "Israel will withdraw" / "Israel will not withdraw" from
   * "disarmament must be genuine, not fictitious" or "will reduce drills" /
   * "is not happy about drills".
   */
  const POLARITY_MIN_SIM = 0.8;
  const POLARITY_MIN_SHARED = 4;
  /**
   * Quantity disputes are restricted to the impact figures newsrooms actually
   * differ on — deaths, injuries, arrests, displacement. Generic measures
   * ("hours", "percent") produce noise: two claims can both count hours while
   * describing different subjects entirely.
   */
  const QUANTITY_MEASURES = new Set(FAMILIES.map((f) => f.key));

  for (let i = 0; i < facts.length; i++) {
    for (let j = i + 1; j < facts.length; j++) {
      const A = facts[i];
      const B = facts[j];
      const ta = tokens.get(A.id)!;
      const tb = tokens.get(B.id)!;

      const sim = claimSimilarity(ta, tb);
      const shared = overlapCount(ta.content, tb.content);
      if (shared < 3 || sim < 0.5) continue;

      let hit: Contradiction | null = null;

      if (ta.negated !== tb.negated) {
        if (sim >= POLARITY_MIN_SIM && shared >= POLARITY_MIN_SHARED) {
          hit = {
            a: A.id,
            b: B.id,
            kind: "polarity",
            uncertainty: "opposite polarity on the same proposition",
            detail: `One account asserts this and the other denies it, with ${Math.round(sim * 100)}% of the underlying wording shared.`,
          };
        }
      } else {
        for (const [measure, va] of ta.quantities) {
          if (!QUANTITY_MEASURES.has(measure)) continue;
          const vb = tb.quantities.get(measure);
          if (vb === undefined || va === vb) continue;
          const spread = Math.abs(va - vb) / Math.max(va, vb, 1);
          if (spread < 0.1) continue; // rounding or "at least", not disagreement
          hit = {
            a: A.id,
            b: B.id,
            kind: "quantity",
            uncertainty: `conflicting ${measure} figures`,
            detail: `One account reports ${va} ${measure}, the other ${vb}.`,
          };
          break;
        }
      }

      if (!hit) continue;
      out.push(hit);
      for (const [x, y] of [
        [A.id, B.id],
        [B.id, A.id],
      ]) {
        const list = contradicted.get(x) ?? [];
        if (!list.includes(y)) list.push(y);
        contradicted.set(x, list);
      }
    }
  }

  if (contradicted.size) {
    const upd = db.prepare("UPDATE cluster_facts SET contradicted_by=?, tier='disputed', status='disputed', tier_reason=? WHERE id=?");
    const reason = tierFor({ independent: 0, outlets: 0, contradicted: true }).reason;
    const tx = db.transaction(() => {
      for (const [id, others] of contradicted) upd.run(JSON.stringify(others), reason, id);
    });
    tx();
    for (const f of facts) {
      const others = contradicted.get(f.id);
      if (!others) continue;
      f.contradicted_by = JSON.stringify(others);
      f.tier = "disputed";
      f.status = "disputed";
      f.tier_reason = reason;
    }
  }

  return out;
}
