import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { analyzeCluster } from "@/lib/intelligence";
import { metricsFor } from "@/lib/enrich";
import { verifyStatusOf, verifyStory } from "@/lib/verifyStory";
import { IMPORTANCE_METHOD, SENTIMENT_METHOD, importanceBand, sentimentBand } from "@/lib/scoring";
import type { StoryIntelligence } from "@/lib/intelligence";

export const maxDuration = 300;

interface ArticleRow {
  id: string;
  title: string;
  summary: string | null;
  url: string;
  author: string | null;
  published_at: number;
  image_url: string | null;
  source_id: string;
  source_name: string;
  lean: string;
  country: string;
  similarity: number;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const cluster = db.prepare("SELECT * FROM clusters WHERE id=?").get(id) as Record<string, unknown> | undefined;
  if (!cluster) return NextResponse.json({ error: "not found" }, { status: 404 });

  const articles = db.prepare(`
    SELECT a.id, a.title, a.summary, a.url, a.author, a.published_at, a.image_url,
           a.source_id, s.name AS source_name, s.lean, s.country, ca.similarity
    FROM cluster_articles ca JOIN articles a ON a.id=ca.article_id JOIN sources s ON s.id=a.source_id
    WHERE ca.cluster_id=? ORDER BY a.published_at DESC
  `).all(id) as ArticleRow[];

  const episodes = (db.prepare("SELECT id, title, status, language, format, audio_duration, created_at, evaluation FROM episodes WHERE cluster_id=? ORDER BY created_at DESC").all(id) as Record<string, unknown>[])
    .map((e) => ({ ...e, evaluation: e.evaluation ? JSON.parse(e.evaluation as string) : null }));

  const sparkline = db.prepare("SELECT score, taken_at FROM trend_snapshots WHERE cluster_id=? ORDER BY taken_at ASC LIMIT 40").all(id);

  db.prepare("INSERT INTO interactions (cluster_id, kind, created_at) VALUES (?,?,?)").run(id, "view", Date.now());

  const intelligence = cluster.intelligence ? (JSON.parse(cluster.intelligence as string) as StoryIntelligence) : null;

  // Every displayed number ships with its own derivation, so the UI never has to
  // hardcode an explanation that can drift from the maths.
  const metrics = metricsFor({
    articles,
    firstSeen: Number(cluster.first_seen),
    scoredAt: Number(cluster.last_updated),
    articleCount: articles.length,
    sourceCount: new Set(articles.map((a) => a.source_id)).size,
  });

  const scoreExplain = intelligence
    ? {
        importance: { ...importanceBand(intelligence.importance), method: IMPORTANCE_METHOD },
        // The model emits sentiment on -1..1; the band scale is 0..100 with 50
        // neutral, so it has to be mapped before it is banded.
        sentiment: {
          ...sentimentBand(Math.round((intelligence.sentiment + 1) * 50)),
          scaled: Math.round((intelligence.sentiment + 1) * 50),
          raw: intelligence.sentiment,
          method: SENTIMENT_METHOD,
        },
      }
    : null;

  const factCount = (db.prepare("SELECT COUNT(*) n FROM cluster_facts WHERE cluster_id=?").get(id) as { n: number }).n;

  return NextResponse.json({
    ...cluster,
    topics: JSON.parse((cluster.topics as string) ?? "[]"),
    entities: JSON.parse((cluster.entities as string) ?? "[]"),
    intelligence,
    articles,
    episodes,
    sparkline,
    metrics,
    score_explain: scoreExplain,
    verification: { ...verifyStatusOf(id), fact_count: factCount },
  });
}

/**
 * POST body:
 *   {analyze:true}  — (re)compute story intelligence, then verify claims.
 *   {verify:true}   — re-run the evidence layer only (the Re-verify button).
 *
 * Verification is deliberately coupled to analysis rather than to podcast
 * generation: a reader checking whether a claim holds up should never have to
 * render audio first.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  if (body.verify) {
    const result = await verifyStory(id, { fuse: body.fuse !== false, force: !!body.force });
    return NextResponse.json({ verification: result });
  }

  if (body.analyze) {
    const intel = await analyzeCluster(id, !!body.force);
    // Claim extraction and cross-attestation run in the same pass so the
    // dossier is never empty behind a "generate a podcast first" dead end.
    const verification = await verifyStory(id, { fuse: true, force: !!body.force });
    return NextResponse.json({
      intelligence: intel,
      verification: {
        status: verification.status,
        verified_at: verification.verified_at,
        fact_count: verification.facts.length,
        tiers: verification.tiers,
        contradictions: verification.contradictions.length,
        error: verification.error,
      },
    });
  }

  return NextResponse.json({ ok: true });
}
