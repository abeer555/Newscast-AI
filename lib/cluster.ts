import crypto from "crypto";
import { getDb } from "./db";

interface ArticleRow {
  id: string;
  source_id: string;
  title: string;
  summary: string | null;
  published_at: number;
  tokens: string | null;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * Cluster recent articles into stories using greedy token-similarity union-find.
 * A story = articles from >=1 sources covering the same event.
 */
export function clusterRecent(windowHours = 48): { clusters: number; articles: number } {
  const db = getDb();
  const since = Date.now() - windowHours * 3600_000;
  const articles = db
    .prepare("SELECT id, source_id, title, summary, published_at, tokens FROM articles WHERE published_at > ? ORDER BY published_at DESC")
    .all(since) as ArticleRow[];

  // TF-weighted token sets for similarity
  const tokenSets = new Map<string, Set<string>>();
  for (const a of articles) {
    const toks: string[] = a.tokens ? JSON.parse(a.tokens) : [];
    tokenSets.set(a.id, new Set(toks.slice(0, 16)));
  }

  // Union-find
  const parent = new Map<string, string>(articles.map((a) => [a.id, a.id]));
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const union = (x: string, y: string) => {
    const rx = find(x), ry = find(y);
    if (rx !== ry) parent.set(rx, ry);
  };

  // O(n²) over a capped window — typical n < 500, acceptable
  const capped = articles.slice(0, 600);
  for (let i = 0; i < capped.length; i++) {
    const ti = tokenSets.get(capped[i].id)!;
    if (!ti.size) continue;
    for (let j = i + 1; j < capped.length; j++) {
      const tj = tokenSets.get(capped[j].id)!;
      if (!tj.size) continue;
      // quick overlap pre-check
      let overlap = 0;
      for (const t of ti) if (tj.has(t)) overlap++;
      if (overlap < 3) continue;
      const sim = jaccard(ti, tj);
      // multi-source events: require stronger overlap for same-source dedupe vs cross-source
      const sameSource = capped[i].source_id === capped[j].source_id;
      if (sim >= (sameSource ? 0.42 : 0.33)) union(capped[i].id, capped[j].id);
    }
  }

  const groups = new Map<string, ArticleRow[]>();
  for (const a of capped) {
    const root = find(a.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(a);
  }

  const now = Date.now();
  const upsertCluster = db.prepare(`
    INSERT INTO clusters (id, title, canonical_article_id, category, topics, entities, trend_score, velocity, first_seen, last_updated, pipeline_stage)
    VALUES (@id, @title, @canonical, @category, @topics, @entities, @trend, @velocity, @first_seen, @now, 'clustered')
    ON CONFLICT(id) DO UPDATE SET
      title=excluded.title, trend_score=excluded.trend_score, velocity=excluded.velocity,
      last_updated=excluded.last_updated, pipeline_stage='clustered'
  `);
  const linkArticle = db.prepare("INSERT OR REPLACE INTO cluster_articles (cluster_id, article_id, similarity) VALUES (?,?,?)");
  const detachOld = db.prepare("DELETE FROM cluster_articles WHERE cluster_id = ?");
  const findCluster = db.prepare("SELECT cluster_id FROM cluster_articles WHERE article_id = ?");

  let clusterCount = 0;
  const tx = db.transaction(() => {
    for (const members of groups.values()) {
      members.sort((a, b) => b.published_at - a.published_at);
      const canonical = members[0];
      // reuse an existing cluster id if any member was previously clustered (stability)
      let clusterId: string | null = null;
      for (const m of members) {
        const row = findCluster.get(m.id) as { cluster_id: string } | undefined;
        if (row) { clusterId = row.cluster_id; break; }
      }
      if (!clusterId) {
        clusterId = crypto.createHash("sha1").update(members.map((m) => m.id).sort().join("|")).digest("hex").slice(0, 16);
      }

      const sourceCount = new Set(members.map((m) => m.source_id)).size;
      const ageHours = Math.max(0.5, (now - members[members.length - 1].published_at) / 3600_000);
      const recencyBoost = Math.max(0.2, 1 - ageHours / windowHours);
      // trending = coverage breadth × recency × freshness velocity
      const trend = Math.round((sourceCount * 12 + members.length * 4) * recencyBoost * 10) / 10;
      const velocity = members.length / ageHours;

      // topic extraction: most common tokens across cluster
      const tf = new Map<string, number>();
      for (const m of members) for (const t of tokenSets.get(m.id) ?? []) tf.set(t, (tf.get(t) ?? 0) + 1);
      const topics = [...tf.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t);
      const category = guessCategory(topics);

      upsertCluster.run({
        id: clusterId,
        title: canonical.title,
        canonical: canonical.id,
        category,
        topics: JSON.stringify(topics),
        entities: JSON.stringify([]),
        trend,
        velocity: Math.round(velocity * 100) / 100,
        first_seen: members[members.length - 1].published_at,
        now,
      });
      detachOld.run(clusterId);
      for (const m of members) {
        const sim = m.id === canonical.id ? 1 : jaccard(tokenSets.get(m.id)!, tokenSets.get(canonical.id)!);
        linkArticle.run(clusterId, m.id, Math.round(sim * 1000) / 1000);
      }
      clusterCount++;
    }
  });
  tx();

  // snapshot top trending for sparklines
  const top = db.prepare("SELECT id, trend_score FROM clusters ORDER BY trend_score DESC LIMIT 25").all() as { id: string; trend_score: number }[];
  const snap = db.prepare("INSERT INTO trend_snapshots (cluster_id, score, taken_at) VALUES (?,?,?)");
  const stx = db.transaction(() => { for (const t of top) snap.run(t.id, t.trend_score, now); });
  stx();

  return { clusters: clusterCount, articles: capped.length };
}

export function guessCategory(topics: string[]): string {
  const t = new Set(topics);
  const has = (...ws: string[]) => ws.some((w) => t.has(w));
  if (has("election", "president", "minister", "parliament", "senate", "vote", "government", "policy", "trump", "tariff")) return "politics";
  if (has("war", "military", "attack", "missile", "troops", "ceasefire", "strike", "conflict", "gaza", "ukraine")) return "conflict";
  if (has("ai", "tech", "software", "startup", "app", "data", "cyber", "chip", "model", "openai", "google", "apple", "microsoft")) return "technology";
  if (has("market", "stocks", "economy", "inflation", "bank", "fed", "oil", "trade", "bitcoin", "earnings")) return "business";
  if (has("health", "virus", "vaccine", "disease", "hospital", "drug", "cancer", "study")) return "health";
  if (has("climate", "storm", "earthquake", "flood", "wildfire", "weather", "hurricane")) return "climate";
  if (has("match", "league", "cup", "player", "coach", "goal", "olympics", "football")) return "sports";
  if (has("space", "nasa", "rocket", "moon", "mars", "research", "scientists", "quantum")) return "science";
  return "general";
}
