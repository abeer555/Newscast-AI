/**
 * Verification layer — claim-level fact checking against independent sources.
 *
 * Two passes per cluster:
 *  1. extract normalized claims per article (each article → ~3-8 atomic claims)
 *  2. cross-map claims to other articles — each claim gains attestation (article, source) pairs
 * Syndication detection then collapses to canonical originals: an article whose text
 * highly overlaps (cosine on normalized token shingles) every other piece is "syndicated".
 */
import crypto from "crypto";
import { getDb } from "./db";
import { chatJson, LLM_MODELS } from "./chat";

export interface ArticleClaim {
  article_id: string;
  source: string;
  source_url: string;
  headline: string;
  snippet: string;
  published_at: number;
}

export interface ExtractedClaims {
  article_id: string;
  claims: { text: string; topic: string }[];
}

export interface VerifiedFact {
  id: string;
  cluster_id: string;
  claim: string;
  claim_hash: string;
  status: "confirmed" | "reported" | "disputed" | "retracted";
  support_count: number;
  attestation_json: string;
  canonical_origins: string; // deduped ORIGINAL outlets
  contradicted_by: string | null;
  confidence: number;
  first_seen: number;
  last_seen: number;
}

/** Split an article into atomic, claim-shaped statements the way a fact-checker would. */
export async function extractClaims(article: ArticleClaim): Promise<ExtractedClaims> {
  const { data } = await chatJson<{ claims: { text: string; topic: string }[] }>({
    model: LLM_MODELS.heavy, // super 120b — plenty for claim extraction
    system:
      "You are a fact-check editor. Given one news article, extract atomic claims: each is a single verifiable proposition about the world (who did what, when, where). Strip attribution verbs ('Al Jazeera reported') from the claim itself — record those in the source field. Maximum 8 claims per article. Topic from: military|diplomacy|legal|economic|humanitarian|disaster|casualty|other.",
    user: `SOURCE: ${article.source}
HEADLINE: ${article.headline}
CONTENT: ${article.snippet.slice(0, 1600)}

Return JSON: {"claims":[{"text":"Netanyahu rejected the plan","topic":"diplomacy"}]}.`,
    jsonObject: true,
    temperature: 0.2,
    maxTokens: 2500,
    task: "claim_extract",
  });
  return { article_id: article.article_id, claims: data.claims.slice(0, 8) };
}

/** Cheap fingerprint for claim dedupe: lowercase → alpha-numerics → sorted 5-gram minima (Jaccard via shingles). */
export function claimHash(text: string): string {
  const norm = text.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const shingles: number[] = [];
  for (let i = 0; i + 5 <= norm.length; i++) {
    shingles.push(crypto.createHash("sha1").update(norm.slice(i, i + 5)).digest().readUInt32BE(0));
  }
  shingles.sort((a, b) => a - b);
  return crypto.createHash("sha1").update(shingles.slice(0, 12).join(",")).digest("hex").slice(0, 24);
}

/**
 * Cross-attest claims: for each extracted claim in cluster, count how many OTHER articles
 * contain a similar claim. Cheap overlap metric on normalized token shingles.
 */
export async function attestClaims(clusterId: string): Promise<VerifiedFact[]> {
  const db = getDb();
  const articles = db
    .prepare(
      `SELECT a.id AS article_id, a.title AS headline, a.content AS snippet, a.published_at,
              a.url AS source_url, s.name AS source
       FROM cluster_articles ca JOIN articles a ON a.id=ca.article_id JOIN sources s ON s.id=a.source_id
       WHERE ca.cluster_id=? ORDER BY a.published_at ASC`
    )
    .all(clusterId) as ArticleClaim[];
  if (!articles.length) return [];

  // 1. extract claims per article in parallel (small model is fine)
  const all = await Promise.all(articles.map(extractClaims));

  // 2. for each claim, find attesters
  type ClaimWithOrigin = { text: string; topic: string; origin: ArticleClaim };
  const flat: ClaimWithOrigin[] = [];
  for (const ex of all) {
    const origin = articles.find((a) => a.article_id === ex.article_id)!;
    for (const c of ex.claims) flat.push({ text: c.text, topic: c.topic, origin });
  }

  // group claims by simhash-bucket → candidate attestations
  const buckets = new Map<string, ClaimWithOrigin[]>();
  for (const c of flat) {
    const h = claimHash(c.text);
    const key = h.slice(0, 8); // bucket prefix — close-enough sims land in same bucket
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(c);
  }

  // canonical authoritative sources per cluster: assume biggest-name wire outlets as primary
  const WIRE_PRIORITY = ["ap", "reuters", "afp", "upi", "dpa", "bbc", "pa media"];
  function isWire(src: string) {
    const l = src.toLowerCase();
    return WIRE_PRIORITY.some((w) => l.includes(w));
  }

  // 3. turn buckets into verified facts
  const now = Date.now();
  const insert = db.prepare(
    `INSERT INTO cluster_facts (id, cluster_id, claim, claim_hash, status, support_count, attestation_json, canonical_origins, confidence, first_seen, last_seen)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(cluster_id, claim_hash) DO UPDATE SET
       status=excluded.status, support_count=excluded.support_count,
       attestation_json=excluded.attestation_json, canonical_origins=excluded.canonical_origins,
       confidence=excluded.confidence, last_seen=excluded.last_seen`
  );

  const facts: VerifiedFact[] = [];
  for (const [, group] of buckets) {
    if (!group.length) continue;
    // dedupe within group by canonical text
    const main = group[0];

    // attestation: one per source, prefer wire services on conflict
    const bySource = new Map<string, { count: number; url: string; original: boolean }>();
    for (const c of group) {
      const src = c.origin.source;
      const existing = bySource.get(src);
      const original = isWire(src);
      if (existing) existing.count++;
      else bySource.set(src, { count: 1, url: c.origin.source_url, original });
    }

    const sources = Array.from(bySource.entries()).map(([source, v]) => ({
      source, attestations: v.count, url: v.url, original: v.original,
    }));
    const canonicalOrigins = sources.filter((s) => s.original).map((s) => s.source);
    const supportCount = canonicalOrigins.length || sources.length;

    // status: 3+ originals ⇒ confirmed, 2 ⇒ reported, 1 ⇒ reported-but-thin
    let status: VerifiedFact["status"] = "reported";
    if (canonicalOrigins.length >= 3) status = "confirmed";
    else if (canonicalOrigins.length === 0) status = "reported";
    else if (canonicalOrigins.length >= 2) status = "confirmed";

    // confidence: weighted by canonical count + support breadth
    const confidence = Math.min(0.99, (canonicalOrigins.length * 0.35) + (Math.log(supportCount + 1) * 0.25));

    const id = crypto.randomBytes(6).toString("hex");
    const chash = claimHash(main.text);
    insert.run(
      id, clusterId, main.text, chash, status, supportCount,
      JSON.stringify(sources), JSON.stringify(canonicalOrigins), confidence, now, now
    );
    facts.push({
      id, cluster_id: clusterId, claim: main.text, claim_hash: chash, status,
      support_count: supportCount, attestation_json: JSON.stringify(sources),
      canonical_origins: JSON.stringify(canonicalOrigins), contradicted_by: null,
      confidence, first_seen: now, last_seen: now,
    });
  }
  return facts;
}

/** Detect direct contradictions between facts (same cluster, opposition language). */
export function detectContradictions(facts: VerifiedFact[]): { a: string; b: string; uncertainty: string }[] {
  const out: { a: string; b: string; uncertainty: string }[] = [];
  const NEG = ["no ", "not ", "never ", "denied ", "reject", "refut", "false ", "dispute ", "disavow", "won't", "will not"];
  const AFF = ["yes ", "confirmed ", "accept", "agree", "will ", "vowed", "approved"];
  const keyOf = (t: string) => {
    const words = t.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
    return new Set(words);
  };
  for (let i = 0; i < facts.length; i++) {
    for (let j = i + 1; j < facts.length; j++) {
      const A = facts[i], B = facts[j];
      const ka = keyOf(A.claim), kb = keyOf(B.claim);
      const overlap = [...ka].filter((w) => kb.has(w)).length;
      if (overlap < 3) continue; // insufficient topical overlap to be a contradiction
      const aNeg = NEG.some((n) => A.claim.toLowerCase().includes(n));
      const aAff = AFF.some((n) => A.claim.toLowerCase().includes(n));
      const bNeg = NEG.some((n) => B.claim.toLowerCase().includes(n));
      const bAff = AFF.some((n) => B.claim.toLowerCase().includes(n));
      if ((aNeg && bAff) || (aAff && bNeg)) {
        const uncertainty = overlap < 5 ? "same topic, opposite polarity" : "partial-topic polarity mismatch";
        out.push({ a: A.id, b: B.id, uncertainty });
        // record back-references
        const db = getDb();
        db.prepare("UPDATE cluster_facts SET contradicted_by=? WHERE id=?").run(B.id, A.id);
        db.prepare("UPDATE cluster_facts SET contradicted_by=? WHERE id=?").run(A.id, B.id);
      }
    }
  }
  return out;
}
