import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { enrichStories } from "@/lib/enrich";
import { evidenceForClusters } from "@/lib/pulse";
import { INDIA_SOURCE_IDS } from "@/lib/sources";
import { safeArray } from "@/lib/json";

interface IndiaRow extends Record<string, unknown> {
  id: string;
  first_seen: number;
  last_updated: number;
  article_count: number;
  source_count: number;
  topics: string | null;
  sources: string | null;
  has_intel: number;
  has_india_coverage: number;
}

export async function GET(req: NextRequest) {
  const db = getDb();
  const sp = req.nextUrl.searchParams;
  const sort = sp.get("sort") ?? "trend";
  const limit = Math.min(60, parseInt(sp.get("limit") ?? "30"));
  const search = sp.get("q");
  const category = sp.get("category");
  const since = sp.get("since"); // hour | today | week

  let orderBy = "c.trend_score DESC";
  if (sort === "recent") orderBy = "c.last_updated DESC";
  if (sort === "coverage") orderBy = "source_count DESC";
  if (sort === "velocity") orderBy = "c.velocity DESC";

  const clauses: string[] = [];
  const params: unknown[] = [];
  if (search) { clauses.push("c.title LIKE ?"); params.push(`%${search}%`); }
  if (category && category !== "all") { clauses.push("c.category = ?"); params.push(category); }
  const windowMs: Record<string, number> = { hour: 3600_000, today: 86_400_000, week: 7 * 86_400_000 };
  if (since && windowMs[since]) { clauses.push("c.last_updated > ?"); params.push(Date.now() - windowMs[since]); }

  const placeholders = Array.from(INDIA_SOURCE_IDS).map(() => "?").join(",");

  const rows = db.prepare(`
    SELECT c.id, c.title, c.category, c.topics, c.trend_score, c.velocity, c.first_seen, c.last_updated,
           c.pipeline_stage, c.intelligence IS NOT NULL AS has_intel,
           COUNT(ca.article_id) AS article_count,
           COUNT(DISTINCT a.source_id) AS source_count,
           (SELECT GROUP_CONCAT(DISTINCT s2.name) FROM cluster_articles ca2 JOIN articles a2 ON a2.id=ca2.article_id JOIN sources s2 ON s2.id=a2.source_id WHERE ca2.cluster_id=c.id) AS sources,
           (SELECT a3.image_url FROM cluster_articles ca3 JOIN articles a3 ON a3.id=ca3.article_id WHERE ca3.cluster_id=c.id AND a3.image_url IS NOT NULL LIMIT 1) AS image_url,
           (SELECT a4.summary FROM articles a4 WHERE a4.id=c.canonical_article_id) AS summary,
           MAX(CASE WHEN a.source_id IN (${placeholders}) THEN 1 ELSE 0 END) AS has_india_coverage
    FROM clusters c
    JOIN cluster_articles ca ON ca.cluster_id=c.id
    JOIN articles a ON a.id=ca.article_id
    WHERE a.source_id IN (${placeholders})
    ${clauses.length ? "AND " + clauses.join(" AND ") : ""}
    GROUP BY c.id
    HAVING source_count >= 1
    ORDER BY ${orderBy}
    LIMIT ?
  `).all(...Array.from(INDIA_SOURCE_IDS), ...Array.from(INDIA_SOURCE_IDS), ...params, limit) as IndiaRow[];

  // Category facets are computed over the unfiltered India pool so the filter
  // bar can show counts and disable empty options rather than leading to a
  // dead end.
  const facets = db.prepare(`
    SELECT c.category, COUNT(DISTINCT c.id) n
    FROM clusters c
    JOIN cluster_articles ca ON ca.cluster_id=c.id
    JOIN articles a ON a.id=ca.article_id
    WHERE a.source_id IN (${placeholders})
    GROUP BY c.category ORDER BY n DESC
  `).all(...Array.from(INDIA_SOURCE_IDS)) as { category: string; n: number }[];

  // Time-window facets, same purpose: the reader can see there is nothing in the
  // last hour before clicking into an empty list.
  const windows: { key: string; label: string; n: number }[] = [
    { key: "hour", label: "Last hour", n: 0 },
    { key: "today", label: "Last 24h", n: 0 },
    { key: "week", label: "Last 7 days", n: 0 },
  ].map((w) => ({
    ...w,
    n: ((db.prepare(`
      SELECT COUNT(DISTINCT c.id) n
      FROM clusters c
      JOIN cluster_articles ca ON ca.cluster_id=c.id
      JOIN articles a ON a.id=ca.article_id
      WHERE a.source_id IN (${placeholders}) AND c.last_updated > ?
    `).get(...Array.from(INDIA_SOURCE_IDS), Date.now() - windowMs[w.key]) as { n: number } | undefined)?.n ?? 0),
  }));

  const evidence = evidenceForClusters(rows.map((r) => r.id));

  return NextResponse.json({
    stories: enrichStories(rows).map((r) => ({
      ...r,
      topics: safeArray<string>(r.topics),
      sources: (r.sources ?? "").split(",").filter(Boolean),
      has_intel: !!r.has_intel,
      india_origin: !!r.has_india_coverage,
      evidence: evidence.get(r.id) ?? {
        claims: 0, confirmed: 0, corroborated: 0, reported: 0, disputed: 0, verified: false, best_tier: "none" as const,
      },
    })),
    facets,
    windows,
    total: rows.length,
  });
}
