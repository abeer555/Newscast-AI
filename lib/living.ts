/**
 * Living story: evolve a cluster's fused summary + timeline as new articles arrive.
 * Idempotent: re-running on the same articles is a no-op; new articles trigger a fusion pass.
 */
import { getDb } from "./db";
import { chatJson, LLM_MODELS } from "./chat";
import crypto from "crypto";

export interface TimelineEvent { t: string; event: string; source_ids: string[] }
export interface LivingStory {
  cluster_id: string;
  current_summary: string;
  current_summary_at: number;
  version: number;
  timeline: TimelineEvent[];
  last_fused_at: number;
}

interface FusedStory {
  summary: string;
  timeline: { t: string; event: string; source_ids: string[] }[];
}

export async function fuseStory(clusterId: string): Promise<LivingStory> {
  const db = getDb();
  const articles = db
    .prepare(
      `SELECT a.id, a.title, a.summary, a.content, a.published_at, s.name AS source_name
       FROM cluster_articles ca JOIN articles a ON a.id=ca.article_id JOIN sources s ON s.id=a.source_id
       WHERE ca.cluster_id=? ORDER BY a.published_at ASC`
    )
    .all(clusterId) as { id: string; title: string; summary: string; content: string; published_at: number; source_name: string }[];
  if (!articles.length) throw new Error("cluster has no articles");

  const existing = db.prepare("SELECT version, timeline FROM living_story WHERE cluster_id=?").get(clusterId) as { version: number; timeline: string } | undefined;
  const priorTimeline: TimelineEvent[] = existing ? JSON.parse(existing.timeline) : [];
  const lastArticleTs = articles[articles.length - 1].published_at;
  const lastFusedAt = existing ? (db.prepare("SELECT last_fused_at FROM living_story WHERE cluster_id=?").get(clusterId) as { last_fused_at: number }).last_fused_at : 0;

  // Skip fusion if nothing new since last run (saves tokens on repeat polls)
  if (existing && lastArticleTs <= lastFusedAt) {
    const s = db.prepare("SELECT * FROM living_story WHERE cluster_id=?").get(clusterId) as Record<string, unknown>;
    return {
      cluster_id: clusterId,
      current_summary: String(s.current_summary),
      current_summary_at: Number(s.current_summary_at),
      version: Number(s.version),
      timeline: JSON.parse(String(s.timeline)),
      last_fused_at: Number(s.last_fused_at),
    };
  }

  // Build the fusion prompt: what's known + what's new
  const known = priorTimeline.slice(-30).map((e) => `${e.t} — ${e.event}`).join("\n");
  const recentArticles = articles.slice(-12); // last 12 articles
  const body = recentArticles
    .map((a) => {
      const snippet = (a.content || a.summary || "").slice(0, 600);
      return `[${a.id}] ${new Date(a.published_at).toUTCString()}  ${a.source_name}\n${a.title}\n${snippet}`;
    })
    .join("\n\n---\n\n");

  const { data } = await chatJson<FusedStory>({
    model: LLM_MODELS.frontier,
    system:
      "You are the managing editor of NEWSCAST AI. You maintain ONE evolving news story per event. Given the timeline-so-far and recent articles, write a single integrated story (8-12 sentences) that folds the new material into the existing arc — not a per-article summary. Then extend the timeline with any genuinely new events you can date precisely. Use ISO timestamps where possible; otherwise use 'Day N' relative labels. Never invent events not in the articles. Keep prior timeline entries that still stand.",
    user: `EXISTING TIMELINE (${priorTimeline.length} events so far):
${known || "(no prior timeline — this is the first fusion pass)"}

RECENT ARTICLES (${recentArticles.length}):
${body}

Return JSON: {"summary":"…8-12 sentence integrated story…","timeline":[{"t":"2025-10-07T06:30Z","event":"…","source_ids":["<article-id>"]}]}. Only include NEW events not already in the timeline.`,
    jsonObject: true,
    maxTokens: 5000,
    temperature: 0.35,
    task: "fusion",
  });

  const newEvents = (data.timeline || []).map((e) => ({
    t: e.t,
    event: e.event,
    source_ids: e.source_ids ?? [],
  }));
  const timeline = [...priorTimeline];
  // merge by event text — dedupe duplicates
  const knownEvents = new Set(priorTimeline.map((e) => e.event.toLowerCase().slice(0, 60)));
  for (const e of newEvents) {
    const k = e.event.toLowerCase().slice(0, 60);
    if (!knownEvents.has(k)) { timeline.push(e); knownEvents.add(k); }
  }
  timeline.sort((a, b) => a.t.localeCompare(b.t));

  const now = Date.now();
  const version = (existing?.version ?? 0) + 1;
  db.prepare(`
    INSERT INTO living_story (cluster_id, current_summary, current_summary_at, version, timeline, last_fused_at)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(cluster_id) DO UPDATE SET
      current_summary=excluded.current_summary,
      current_summary_at=excluded.current_summary_at,
      version=excluded.version,
      timeline=excluded.timeline,
      last_fused_at=excluded.last_fused_at
  `).run(clusterId, data.summary, now, version, JSON.stringify(timeline), lastArticleTs);

  return {
    cluster_id: clusterId,
    current_summary: data.summary,
    current_summary_at: now,
    version,
    timeline,
    last_fused_at: lastArticleTs,
  };
}

/** Snapshot how a cluster's story evolved over time (for diff views). */
export function storyVersionHistory(clusterId: string): { version: number; at: number; len: number }[] {
  const db = getDb();
  const r = db.prepare("SELECT version, current_summary_at, LENGTH(current_summary) AS len FROM living_story WHERE cluster_id=?").get(clusterId) as { version: number; current_summary_at: number; len: number } | undefined;
  return r ? [{ version: r.version, at: r.current_summary_at, len: r.len }] : [];
}
