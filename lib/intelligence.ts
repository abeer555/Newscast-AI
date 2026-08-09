import { getDb } from "./db";
import { chatJson } from "./groq";

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
}

const INTEL_SCHEMA = {
  name: "story_intelligence",
  schema: {
    type: "object",
    properties: {
      headline: { type: "string" },
      lede: { type: "string" },
      summary_long: { type: "string" },
      category: { type: "string" },
      importance: { type: "number" },
      sentiment: { type: "number" },
      key_facts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            fact: { type: "string" },
            confidence: { type: "string", enum: ["confirmed", "reported", "disputed"] },
          },
          required: ["fact", "confidence"],
          additionalProperties: false,
        },
      },
      entities: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            type: { type: "string", enum: ["person", "org", "place", "other"] },
          },
          required: ["name", "type"],
          additionalProperties: false,
        },
      },
      why_it_matters: { type: "string" },
      what_next: { type: "string" },
      framing: {
        type: "array",
        items: {
          type: "object",
          properties: {
            source: { type: "string" },
            lean: { type: "string" },
            headline: { type: "string" },
            framing: { type: "string" },
            emphasis: { type: "array", items: { type: "string" } },
            tone: { type: "string", enum: ["alarmed", "neutral", "optimistic", "critical", "celebratory", "cautious"] },
            omits: { type: "string" },
          },
          required: ["source", "lean", "headline", "framing", "emphasis", "tone", "omits"],
          additionalProperties: false,
        },
      },
      consensus: { type: "array", items: { type: "string" } },
      disagreements: { type: "array", items: { type: "string" } },
      timeline: {
        type: "array",
        items: {
          type: "object",
          properties: { time: { type: "string" }, event: { type: "string" } },
          required: ["time", "event"],
          additionalProperties: false,
        },
      },
      podcast_angle: { type: "string" },
    },
    required: ["headline", "lede", "summary_long", "category", "importance", "sentiment", "key_facts", "entities", "why_it_matters", "what_next", "framing", "consensus", "disagreements", "timeline", "podcast_angle"],
    additionalProperties: false,
  },
};

export async function analyzeCluster(clusterId: string, force = false): Promise<StoryIntelligence> {
  const db = getDb();
  const cluster = db.prepare("SELECT * FROM clusters WHERE id=?").get(clusterId) as { intelligence: string | null; title: string } | undefined;
  if (!cluster) throw new Error("Cluster not found");
  if (cluster.intelligence && !force) return JSON.parse(cluster.intelligence) as StoryIntelligence;

  const articles = db
    .prepare(
      `SELECT a.title, a.summary, a.content, a.published_at, a.url, s.name AS source_name, s.lean
       FROM cluster_articles ca JOIN articles a ON a.id=ca.article_id JOIN sources s ON s.id=a.source_id
       WHERE ca.cluster_id=? ORDER BY a.published_at DESC LIMIT 10`
    )
    .all(clusterId) as { title: string; summary: string; content: string; published_at: number; url: string; source_name: string; lean: string }[];

  const dossier = articles
    .map((a, i) => {
      const body = (a.content || a.summary || "").slice(0, 900);
      return `--- ARTICLE ${i + 1} | SOURCE: ${a.source_name} (lean: ${a.lean}) | ${new Date(a.published_at).toUTCString()} ---\nHEADLINE: ${a.title}\nURL: ${a.url}\n${body}`;
    })
    .join("\n\n");

  const { data, model } = await chatJson<StoryIntelligence>({
    system:
      "You are the senior intelligence editor at NEWSCAST AI, an autonomous newsroom. Analyze multi-source coverage of a news event. Produce precise, non-partisan, deeply-reported intelligence. Compare how each outlet frames the event: what they emphasize, omit, and their tone. importance is 0-100 (global significance). sentiment is -1..1 (story emotional valence). Consensus lists facts ALL sources agree on; disagreements lists where coverage diverges. Timeline: 3-8 chronological events. podcast_angle: the most compelling narrative hook for an audio episode.",
    user: `Here are ${articles.length} articles covering one event. Produce the full intelligence dossier.\n\n${dossier}`,
    jsonSchema: INTEL_SCHEMA,
    maxTokens: 6000,
    temperature: 0.4,
  });

  // stamp category + entities back onto the cluster
  db.prepare("UPDATE clusters SET intelligence=?, intelligence_at=?, category=?, entities=?, pipeline_stage='analyzed', title=? WHERE id=?")
    .run(JSON.stringify(data), Date.now(), data.category, JSON.stringify(data.entities.map((e) => e.name)), data.headline, clusterId);
  void model;
  return data;
}
