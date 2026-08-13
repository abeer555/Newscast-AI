import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { createEpisode, runEpisodePipeline } from "@/lib/pipeline";
import { EpisodeFormat, ScriptLanguage } from "@/lib/scriptgen";

export async function GET() {
  const db = getDb();
  const episodes = db.prepare(`
    SELECT e.*, c.category AS cluster_category, c.trend_score
    FROM episodes e LEFT JOIN clusters c ON c.id=e.cluster_id
    ORDER BY e.created_at DESC LIMIT 100
  `).all() as Record<string, unknown>[];
  return NextResponse.json({
    episodes: episodes.map((e) => ({
      ...e,
      script: e.script ? JSON.parse(e.script as string) : null,
      evaluation: e.evaluation ? JSON.parse(e.evaluation as string) : null,
      generation_cache: undefined,
    })),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { clusterId, format = "briefing", language = "en", style = "conversational" } = body as {
    clusterId: string; format: EpisodeFormat; language: string; style: string;
  };
  if (!clusterId) return NextResponse.json({ error: "clusterId required" }, { status: 400 });
  const id = createEpisode({ clusterId, format, language: language as ScriptLanguage, style });
  // fire-and-forget pipeline (SSE streams progress)
  void runEpisodePipeline(id);
  return NextResponse.json({ id });
}
