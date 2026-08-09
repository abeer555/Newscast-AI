import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { analyzeCluster } from "@/lib/intelligence";

export const maxDuration = 120;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const cluster = db.prepare("SELECT * FROM clusters WHERE id=?").get(id) as Record<string, unknown> | undefined;
  if (!cluster) return NextResponse.json({ error: "not found" }, { status: 404 });

  const articles = db.prepare(`
    SELECT a.id, a.title, a.summary, a.url, a.author, a.published_at, a.image_url, s.name AS source_name, s.lean, s.country, ca.similarity
    FROM cluster_articles ca JOIN articles a ON a.id=ca.article_id JOIN sources s ON s.id=a.source_id
    WHERE ca.cluster_id=? ORDER BY a.published_at DESC
  `).all(id);

  const episodes = (db.prepare("SELECT id, title, status, language, format, audio_duration, created_at, evaluation FROM episodes WHERE cluster_id=? ORDER BY created_at DESC").all(id) as Record<string, unknown>[])
    .map((e) => ({ ...e, evaluation: e.evaluation ? JSON.parse(e.evaluation as string) : null }));

  const sparkline = db.prepare("SELECT score, taken_at FROM trend_snapshots WHERE cluster_id=? ORDER BY taken_at ASC LIMIT 40").all(id);

  getDb().prepare("INSERT INTO interactions (cluster_id, kind, created_at) VALUES (?,?,?)").run(id, "view", Date.now());

  return NextResponse.json({
    ...cluster,
    topics: JSON.parse((cluster.topics as string) ?? "[]"),
    entities: JSON.parse((cluster.entities as string) ?? "[]"),
    intelligence: cluster.intelligence ? JSON.parse(cluster.intelligence as string) : null,
    articles,
    episodes,
    sparkline,
  });
}

/** POST {analyze: true} to (re)compute story intelligence */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  if (body.analyze) {
    const intel = await analyzeCluster(id, !!body.force);
    return NextResponse.json({ intelligence: intel });
  }
  return NextResponse.json({ ok: true });
}
