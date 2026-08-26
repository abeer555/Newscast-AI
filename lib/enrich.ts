/**
 * Attaches derived, explainable metrics to story rows before they leave the API.
 *
 * List endpoints select cheap aggregate columns; this layer adds the parts that
 * need per-article data — heat with its itemised breakdown, disambiguated
 * velocity, and source independence — so every number the UI renders arrives
 * with the reasoning behind it instead of being explained by a hardcoded
 * tooltip on the client.
 */

import { getDb } from "./db";
import { analyzeIndependence, type ArticleLike, type IndependenceReport } from "./independence";
import { evidenceStrength, heatBreakdown, velocityStats, type EvidenceStrength, type HeatBreakdown, type VelocityStats } from "./scoring";

export interface StoryRowLike {
  id: string;
  first_seen: number;
  last_updated: number;
  article_count: number;
  source_count: number;
  trend_score?: number;
}

export interface StoryMetrics {
  heat: HeatBreakdown;
  velocity: VelocityStats;
  evidence: EvidenceStrength;
  /** Distinct outlets, independent chains, syndicated copies. */
  independence: {
    outlets: number;
    independent: number;
    attributed: number;
    syndicated_copies: number;
    chains: { label: string; kind: "newsroom" | "agency"; outlets: string[] }[];
    broke_first: IndependenceReport["broke_first"];
  };
}

interface RawArticle extends ArticleLike {
  cluster_id: string;
}

function fetchArticlesFor(ids: string[]): Map<string, RawArticle[]> {
  const out = new Map<string, RawArticle[]>();
  if (!ids.length) return out;
  const db = getDb();
  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT ca.cluster_id, a.id, a.source_id, s.name AS source_name, s.lean, a.author, a.published_at, a.title, a.summary
       FROM cluster_articles ca
       JOIN articles a ON a.id = ca.article_id
       JOIN sources s ON s.id = a.source_id
       WHERE ca.cluster_id IN (${placeholders})`,
    )
    .all(...ids) as RawArticle[];
  for (const r of rows) {
    const list = out.get(r.cluster_id);
    if (list) list.push(r);
    else out.set(r.cluster_id, [r]);
  }
  return out;
}

/** Computes metrics for one already-fetched article set. */
export function metricsFor(args: {
  articles: ArticleLike[];
  firstSeen: number;
  scoredAt?: number;
  now?: number;
  /** Fall back to these when the article set is unavailable. */
  articleCount?: number;
  sourceCount?: number;
}): StoryMetrics {
  const now = args.now ?? Date.now();
  const arts = args.articles;
  const indep = analyzeIndependence(arts);
  const articleCount = arts.length || args.articleCount || 0;
  const sourceCount = indep.outlets || args.sourceCount || 0;
  const articles24h = arts.length ? arts.filter((a) => a.published_at > now - 86_400_000).length : null;

  return {
    heat: heatBreakdown({
      sourceCount,
      articleCount,
      firstSeen: args.firstSeen,
      scoredAt: args.scoredAt,
      now,
    }),
    velocity: velocityStats({ articleCount, articles24h, firstSeen: args.firstSeen, now }),
    evidence: evidenceStrength({ outlets: indep.outlets, independent: indep.independent, attributed: indep.attributed }),
    independence: {
      outlets: indep.outlets,
      independent: indep.independent,
      attributed: indep.attributed,
      syndicated_copies: indep.syndicated_copies,
      chains: indep.chains.map((c) => ({ label: c.label, kind: c.kind, outlets: c.outlets })),
      broke_first: indep.broke_first,
    },
  };
}

/**
 * Enriches a page of story rows. `scoredAt` defaults to each row's last_updated
 * so `heat.score` reproduces the stored trend_score the list is sorted by, while
 * `heat.live_score` shows what it has decayed to since.
 */
export function enrichStories<T extends StoryRowLike & Record<string, unknown>>(rows: T[]): (T & { metrics: StoryMetrics })[] {
  const now = Date.now();
  const byCluster = fetchArticlesFor(rows.map((r) => r.id));
  return rows.map((r) => ({
    ...r,
    metrics: metricsFor({
      articles: byCluster.get(r.id) ?? [],
      firstSeen: r.first_seen,
      scoredAt: r.last_updated,
      now,
      articleCount: r.article_count,
      sourceCount: r.source_count,
    }),
  }));
}
