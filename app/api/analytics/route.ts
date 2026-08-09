import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export function GET() {
  const db = getDb();
  const counts = {
    articles: (db.prepare("SELECT COUNT(*) c FROM articles").get() as { c: number }).c,
    clusters: (db.prepare("SELECT COUNT(*) c FROM clusters").get() as { c: number }).c,
    episodes: (db.prepare("SELECT COUNT(*) c FROM episodes").get() as { c: number }).c,
    episodes_ready: (db.prepare("SELECT COUNT(*) c FROM episodes WHERE status='ready'").get() as { c: number }).c,
    sources: (db.prepare("SELECT COUNT(*) c FROM sources WHERE enabled=1").get() as { c: number }).c,
    audio_minutes: Math.round(((db.prepare("SELECT COALESCE(SUM(audio_duration),0) s FROM episodes").get() as { s: number }).s / 60) * 10) / 10,
    plays: (db.prepare("SELECT COALESCE(SUM(play_count),0) s FROM episodes").get() as { s: number }).s,
  };
  const llm = db.prepare(`
    SELECT model, COUNT(*) calls, SUM(tokens_prompt) prompt, SUM(tokens_completion) completion, ROUND(AVG(latency_ms)) avg_latency
    FROM analytics_events WHERE kind='llm_call' GROUP BY model
  `).all();
  const tts = db.prepare("SELECT COUNT(*) calls, ROUND(AVG(latency_ms)) avg_latency, SUM(json_extract(meta,'$.chars')) chars FROM analytics_events WHERE kind='tts_call'").get();
  const recent = db.prepare("SELECT kind, model, tokens_prompt, tokens_completion, latency_ms, created_at FROM analytics_events ORDER BY id DESC LIMIT 30").all();
  const categories = db.prepare("SELECT category, COUNT(*) n FROM clusters GROUP BY category ORDER BY n DESC").all();
  const by_status = db.prepare("SELECT status, COUNT(*) n FROM episodes GROUP BY status").all();
  const quality = db.prepare("SELECT ROUND(AVG(json_extract(evaluation,'$.overall')),1) avg FROM episodes WHERE evaluation IS NOT NULL").get();
  return NextResponse.json({ counts, llm, tts, recent, categories, by_status, quality });
}
