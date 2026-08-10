import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { INDIA_SOURCE_IDS } from "@/lib/sources";

export async function GET(req: NextRequest) {
  const db = getDb();
  const sp = req.nextUrl.searchParams;
  const sort = sp.get("sort") ?? "trend";
  const limit = Math.min(60, parseInt(sp.get("limit") ?? "30"));
  const search = sp.get("q");

  let orderBy = "c.trend_score DESC";
  if (sort === "recent") orderBy = "c.last_updated DESC";
  if (sort === "coverage") orderBy = "source_count DESC";

  const clauses: string[] = [];
  const params: unknown[] = [];
  if (search) { clauses.push("c.title LIKE ?"); params.push(`%${search}%`); }

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
  `).all(...Array.from(INDIA_SOURCE_IDS), ...Array.from(INDIA_SOURCE_IDS), ...params, limit) as Record<string, unknown>[];

  return NextResponse.json({
    stories: rows.map((r) => ({
      ...r,
      topics: JSON.parse((r.topics as string) ?? "[]"),
      sources: ((r.sources as string) ?? "").split(",").filter(Boolean),
      has_intel: !!r.has_intel,
      india_origin: !!r.has_india_coverage,
    })),
  });
}
