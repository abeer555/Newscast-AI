import { getDb } from "./db";
import { chatJson, LLM_MODELS } from "./chat";

export interface SourceFraming {
  source: string;
  lean: string;
  headline: string;
  framing: string;
  emphasis: string[];
  tone: "alarmed" | "neutral" | "optimistic" | "critical" | "celebratory" | "cautious";
  omits: string;
}

export interface TimelineEvent {
  time: string;
  event: string;
}

export interface StoryIntelligence {
  headline: string;
  lede: string;
  summary_long: string;
  category: string;
  importance: number;
  sentiment: number;
  key_facts: { fact: string; confidence: "confirmed" | "reported" | "disputed" }[];
  entities: { name: string; type: "person" | "org" | "place" | "other" }[];
  why_it_matters: string;
  what_next: string;
  framing: SourceFraming[];
  consensus: string[];
  disagreements: string[];
  timeline: TimelineEvent[];
  podcast_angle: string;
  regions: string[];
}

const INTEL_SHAPE = {
  headline: "string — precise, neutral event headline (not clickbait)",
  lede: "string — one sentence capturing who/what/where/when/why",
  summary_long: "string — 4-6 sentence synthesis across ALL outlets",
  category: "string — politics|conflict|technology|business|health|climate|sports|science|general",
  importance: "number 0-100 global significance",
  sentiment: "number -1..1 emotional valence",
  key_facts: [{ fact: "string", confidence: "confirmed|reported|disputed" }],
  entities: [{ name: "string", type: "person|org|place|other" }],
  why_it_matters: "string — 2-3 sentences of stakes and second-order effects",
  what_next: "string — concrete developments to watch",
  framing: [{
    source: "string — outlet name, exactly as given",
    lean: "string — editorial lean as given",
    headline: "string — that outlet's headline",
    framing: "string — 2 sentences: how this outlet tells the story and what narrative it serves",
    emphasis: ["string — 3-5 specific things this outlet foregrounds"],
    tone: "alarmed|neutral|optimistic|critical|celebratory|cautious",
    omits: "string — what this outlet leaves out that others include",
  }],
  consensus: ["string — facts ALL sources agree on"],
  disagreements: ["string — where coverage materially diverges"],
  timeline: [{ time: "ISO timestamp or relative label like 'Tuesday morning'", event: "string" }],
  podcast_angle: "string — the strongest narrative hook for listeners: a tension, question, or human stake",
  regions: ["string — geographic regions involved"],
};

export async function analyzeCluster(clusterId: string, force = false): Promise<StoryIntelligence> {
  const db = getDb();
  const cluster = db.prepare("SELECT * FROM clusters WHERE id=?").get(clusterId) as { intelligence: string | null; title: string } | undefined;
  if (!cluster) throw new Error("Cluster not found");
  if (cluster.intelligence && !force) return JSON.parse(cluster.intelligence) as StoryIntelligence;

  const articles = db
    .prepare(
      `SELECT a.title, a.summary, a.content, a.published_at, a.url, s.name AS source_name, s.lean, s.country
       FROM cluster_articles ca JOIN articles a ON a.id=ca.article_id JOIN sources s ON s.id=a.source_id
       WHERE ca.cluster_id=? ORDER BY a.published_at DESC LIMIT 12`
    )
    .all(clusterId) as { title: string; summary: string; content: string; published_at: number; url: string; source_name: string; lean: string; country: string }[];

  const dossier = articles
    .map((a, i) => {
      const body = (a.content || a.summary || "").slice(0, 1100);
      return `--- ARTICLE ${i + 1} | SOURCE: ${a.source_name} (${a.country}, lean: ${a.lean}) | PUBLISHED: ${new Date(a.published_at).toUTCString()} ---\nHEADLINE: ${a.title}\nBODY: ${body}`;
    })
    .join("\n\n");

  const { data } = await chatJson<StoryIntelligence>({
    model: LLM_MODELS.frontier,
    system:
      "You are the chief intelligence editor of NEWSCAST AI, a global newsroom synthesizing multi-outlet coverage into authoritative, non-partisan briefings for informed professionals. Rules you live by: synthesize ACROSS outlets rather than paraphrasing one; attribute unconfirmed claims to their source; rigorously separate confirmed facts from reported claims from disputed assertions; describe each outlet's framing concretely — their lead facts, word choices, and conspicuous omissions; reconstruct timelines from actual timestamps in the articles. You are precise, fair, and allergic to spin.",
    user: `Below are ${articles.length} articles from different outlets covering the same event. Build the complete intelligence dossier.

${dossier}

Respond with a single JSON object using EXACTLY this shape:
${JSON.stringify(INTEL_SHAPE, null, 1)}`,
    jsonSchema: { schema: { properties: {} } },
    maxTokens: 8000,
    temperature: 0.35,
    task: "intelligence",
  });

  db.prepare("UPDATE clusters SET intelligence=?, intelligence_at=?, category=?, entities=?, pipeline_stage='analyzed', title=? WHERE id=?")
    .run(JSON.stringify(data), Date.now(), data.category, JSON.stringify(data.entities.map((e) => e.name)), data.headline, clusterId);
  return data;
}
