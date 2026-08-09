import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export function GET(req: NextRequest) {
  const db = getDb();
  const sp = req.nextUrl.searchParams;
  const category = sp.get("category");
  const search = sp.get("q");
  const sort = sp.get("sort") ?? "trend";
  const personalized = sp.get("personalized") === "1";
  const limit = Math.min(100, parseInt(sp.get("limit") ?? "40"));

  let orderBy = "c.trend_score DESC";
  if (sort === "recent") orderBy = "c.last_updated DESC";
  if (sort === "coverage") orderBy = "source_count DESC";

  const where: string[] = [];
  const params: unknown[] = [];
  if (category && category !== "all") { where.push("c.category = ?"); params.push(category); }
  if (search) { where.push("c.title LIKE ?"); params.push(`%${search}%`); }

  const rows = db.prepare(`
    SELECT c.id, c.title, c.category, c.topics, c.trend_score, c.velocity, c.first_seen, c.last_updated,
           c.pipeline_stage, c.intelligence IS NOT NULL AS has_intel,
           COUNT(ca.article_id) AS article_count,
           COUNT(DISTINCT a.source_id) AS source_count,
           (SELECT GROUP_CONCAT(DISTINCT s2.name) FROM cluster_articles ca2 JOIN articles a2 ON a2.id=ca2.article_id JOIN sources s2 ON s2.id=a2.source_id WHERE ca2.cluster_id=c.id) AS sources,
           (SELECT a3.image_url FROM cluster_articles ca3 JOIN articles a3 ON a3.id=ca3.article_id WHERE ca3.cluster_id=c.id AND a3.image_url IS NOT NULL LIMIT 1) AS image_url,
           (SELECT a4.summary FROM articles a4 WHERE a4.id=c.canonical_article_id) AS summary
    FROM clusters c
    JOIN cluster_articles ca ON ca.cluster_id=c.id
    JOIN articles a ON a.id=ca.article_id
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    GROUP BY c.id
    ORDER BY ${orderBy}
    LIMIT ?
  `).all(...params, limit) as Record<string, unknown>[];

  let stories = rows.map((r) => ({
    ...r,
    topics: JSON.parse((r.topics as string) ?? "[]") as string[],
    sources: ((r.sources as string) ?? "").split(",").filter(Boolean),
    has_intel: !!r.has_intel,
    personal_score: 0,
  })) as (Record<string, unknown> & { topics: string[]; sources: string[]; personal_score: number })[];

  if (personalized) {
    const prof = db.prepare("SELECT interests FROM user_profile WHERE id='local'").get() as { interests: string } | undefined;
    const interests: string[] = prof ? JSON.parse(prof.interests) : [];
    const inter = db.prepare("SELECT cluster_id, COUNT(*) n FROM interactions WHERE created_at > ? GROUP BY cluster_id").all(Date.now() - 7 * 86400e3) as { cluster_id: string; n: number }[];
    const boost = new Map(inter.map((i) => [i.cluster_id, i.n]));
    stories = stories
      .map((s) => {
        const topicMatch = (s.topics as string[]).filter((t) => interests.some((i) => t.includes(i.toLowerCase()))).length;
        const catMatch = interests.includes(s.category as string) ? 2 : 0;
        return { ...s, personal_score: (s.trend_score as number) + topicMatch * 8 + catMatch * 8 + (boost.get(s.id as string) ?? 0) * 2 };
      })
      .sort((a, b) => (b.personal_score as number) - (a.personal_score as number));
  }

  return NextResponse.json({ stories });
}
