import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { enrichStories } from "@/lib/enrich";
import { evidenceForClusters, newsPulse, type PulseKey } from "@/lib/pulse";

interface StoryRow extends Record<string, unknown> {
  id: string;
  first_seen: number;
  last_updated: number;
  article_count: number;
  source_count: number;
  trend_score: number;
  category: string;
  topics: string | null;
  sources: string | null;
  has_intel: number;
}

const DEVELOPING_MS = 6 * 3_600_000;
const BREAKING_MS = 3 * 3_600_000;

export function GET(req: NextRequest) {
  const db = getDb();
  const sp = req.nextUrl.searchParams;
  const category = sp.get("category");
  const search = sp.get("q");
  const sort = sp.get("sort") ?? "trend";
  const personalized = sp.get("personalized") === "1";
  const filter = sp.get("filter") as PulseKey | null;
  const wantPulse = sp.get("pulse") === "1";
  const limit = Math.min(100, Math.max(1, parseInt(sp.get("limit") ?? "40") || 40));

  let orderBy = "c.trend_score DESC";
  if (sort === "recent") orderBy = "c.last_updated DESC";
  if (sort === "coverage") orderBy = "source_count DESC";
  if (sort === "velocity") orderBy = "c.velocity DESC";

  const where: string[] = [];
  const params: unknown[] = [];
  if (category && category !== "all") { where.push("c.category = ?"); params.push(category); }
  if (search) { where.push("c.title LIKE ?"); params.push(`%${search}%`); }

  // A pulse-facet filter is applied after the evidence join, so over-fetch and
  // trim rather than pushing an approximate condition into SQL.
  const fetchLimit = filter ? Math.min(200, limit * 5) : limit;

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
  `).all(...params, fetchLimit) as StoryRow[];

  const now = Date.now();
  const evidence = evidenceForClusters(rows.map((r) => r.id));

  let stories = enrichStories(rows).map((r) => ({
    ...r,
    topics: JSON.parse(r.topics ?? "[]") as string[],
    sources: (r.sources ?? "").split(",").filter(Boolean),
    has_intel: !!r.has_intel,
    personal_score: 0,
    evidence: evidence.get(r.id) ?? {
      claims: 0, confirmed: 0, corroborated: 0, reported: 0, disputed: 0, verified: false, best_tier: "none" as const,
    },
    developing: r.last_updated > now - DEVELOPING_MS && r.source_count >= 2,
    breaking: r.first_seen > now - BREAKING_MS,
  }));

  if (filter) {
    const match: Record<PulseKey, (s: (typeof stories)[number]) => boolean> = {
      developing: (s) => s.developing,
      breaking: (s) => s.breaking,
      corroborated: (s) => s.evidence.confirmed > 0,
      contested: (s) => s.evidence.disputed > 0,
      single: (s) => s.source_count <= 1,
      unchecked: (s) => !s.evidence.verified,
    };
    const fn = match[filter];
    if (fn) stories = stories.filter(fn);
  }

  if (personalized) {
    const prof = db.prepare("SELECT interests FROM user_profile WHERE id='local'").get() as { interests: string } | undefined;
    const interests: string[] = prof ? JSON.parse(prof.interests) : [];
    const inter = db.prepare("SELECT cluster_id, COUNT(*) n FROM interactions WHERE created_at > ? GROUP BY cluster_id").all(Date.now() - 7 * 86400e3) as { cluster_id: string; n: number }[];
    const boost = new Map(inter.map((i) => [i.cluster_id, i.n]));
    stories = stories
      .map((s) => {
        const topicMatch = s.topics.filter((t) => interests.some((i) => t.includes(i.toLowerCase()))).length;
        const catMatch = interests.includes(s.category) ? 2 : 0;
        return { ...s, personal_score: s.trend_score + topicMatch * 8 + catMatch * 8 + (boost.get(s.id) ?? 0) * 2 };
      })
      .sort((a, b) => b.personal_score - a.personal_score);
  }

  return NextResponse.json({
    stories: stories.slice(0, limit),
    pulse: wantPulse ? newsPulse({ now }) : undefined,
  });
}
