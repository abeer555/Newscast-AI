import { getDb } from "./db";
import { analyzeCluster, StoryIntelligence } from "./intelligence";
import { chatJson } from "./chat";

export interface ScriptSegment {
  index: number;
  speaker: string;
  voice: string;
  direction: string; // vocal direction for Orpheus, e.g. "[warm]" — empty string for none
  text: string;
}

export interface PodcastScript {
  title: string;
  description: string;
  tags: string[];
  hosts: { name: string; role: string; voice: string }[];
  segments: ScriptSegment[];
  estimated_seconds: number;
}

const VOICE_CAST_EN = [
  { name: "Autumn", voice: "autumn", role: "host" },
  { name: "Daniel", voice: "daniel", role: "analyst" },
];
const VOICE_CAST_AR = [
  { name: "نورة", voice: "noura", role: "host" },
  { name: "فهد", voice: "fahad", role: "analyst" },
];

function scriptSchema(maxSeg: number) {
  return {
    name: "podcast_script",
    schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        segments: {
          type: "array",
          items: {
            type: "object",
            properties: {
              speaker: { type: "string", description: "host name from the cast" },
              direction: { type: "string", description: "single Orpheus vocal direction like cheerful or empty string" },
              text: { type: "string", description: "spoken line, 1-2 sentences, max 120 characters, plain speakable text without brackets" },
            },
            required: ["speaker", "direction", "text"],
            additionalProperties: false,
          },
        },
      },
      required: ["title", "description", "tags", "segments"],
      additionalProperties: false,
    },
    maxSeg,
  };
}

export type EpisodeFormat = "briefing" | "deepdive" | "debate";

const FORMAT_SPECS: Record<EpisodeFormat, { segs: string; brief: string }> = {
  briefing: { segs: "14-18", brief: "a tight 90-second morning briefing: hook the listener instantly, deliver the 5 essential facts with momentum, one line of context, crisp sign-off. Energetic pacing." },
  deepdive: { segs: "22-30", brief: "a 3-minute analytical deep-dive: set the scene, walk through what happened, why it matters, how different outlets are framing it, what to watch next. Thoughtful, authoritative." },
  debate: { segs: "20-26", brief: "a spirited but respectful two-host exchange: present the story, then have the hosts naturally explore different angles and tensions (e.g. optimistic vs skeptical readings), converging on what's solid. Conversational chemistry." },
};

export async function generateScript(opts: {
  clusterId: string;
  format: EpisodeFormat;
  language: "en" | "ar";
  style: string;
}): Promise<{ script: PodcastScript; intel: StoryIntelligence; model: string }> {
  const intel = await analyzeCluster(opts.clusterId);
  const db = getDb();
  const articles = db
    .prepare(
      `SELECT a.title, a.summary, s.name AS source_name
       FROM cluster_articles ca JOIN articles a ON a.id=ca.article_id JOIN sources s ON s.id=a.source_id
       WHERE ca.cluster_id=? ORDER BY a.published_at DESC LIMIT 8`
    )
    .all(opts.clusterId) as { title: string; summary: string; source_name: string }[];

  const cast = opts.language === "ar" ? VOICE_CAST_AR : VOICE_CAST_EN;
  const castBlock = cast.map((c) => `${c.name} (${c.role})`).join(", ");
  const spec = FORMAT_SPECS[opts.format];
  const srcList = articles.map((a) => `${a.source_name}: "${a.title}"`).join("; ");

  const langInstruction =
    opts.language === "ar"
      ? "Write the ENTIRE script in Modern Standard Arabic (فصحى), natural broadcast style. Direction field must be an EMPTY string (Arabic model does not support vocal directions)."
      : "Write in English. The direction field may contain ONE short Orpheus vocal direction (e.g. cheerful, warm, serious, thoughtful, curious) or be an empty string; vary it naturally, mostly conversational with occasional expressive moments.";

  const prompt = `STORY INTELLIGENCE DOSSIER:
HEADLINE: ${intel.headline}
LEDE: ${intel.lede}
SUMMARY: ${intel.summary_long}
KEY FACTS: ${intel.key_facts.map((f) => `[${f.confidence}] ${f.fact}`).join(" | ")}
WHY IT MATTERS: ${intel.why_it_matters}
WHAT NEXT: ${intel.what_next}
SOURCE FRAMING: ${intel.framing.map((f) => `${f.source}: ${f.framing}`).join(" | ")}
CONSENSUS: ${intel.consensus.join(" | ")}
DISAGREEMENTS: ${intel.disagreements.join(" | ")}
PODCAST ANGLE: ${intel.podcast_angle}
COVERAGE: ${srcList}

Write ${spec.brief}
Format: NEWSCAST AI audio show "${opts.format}" — two speakers: ${castBlock}. Alternate speakers naturally; the host drives, the analyst adds depth. Reference that sources were cross-checked where relevant. Factual, vivid, human. NEVER invent facts not in the dossier.
Constraints: EXACTLY ${spec.segs} segments. Each segment text is 1-2 short sentences and MUST be under 120 characters (it feeds a text-to-speech engine with a hard limit).
Title: punchy episode title (≤70 chars). Description: 1 sentence. Tags: 3-5 lowercase topics.
${langInstruction}
Speaker field must be exactly one of: ${cast.map((c) => c.name).join(", ")}.`;

  const { data, model } = await chatJson<{ title: string; description: string; tags: string[]; segments: { speaker: string; direction: string; text: string }[] }>({
    system: "You are the head podcast writer at NEWSCAST AI, producing scripts performed by AI voices. You write for the ear: short sentences, no lists, no URLs, natural spoken flow with light chemistry between hosts.",
    user: prompt,
    jsonSchema: scriptSchema(30),
    maxTokens: 5000,
    temperature: 0.75,
  });

  const segments: ScriptSegment[] = data.segments
    .map((s, i) => {
      const castMember = cast.find((c) => c.name.toLowerCase() === s.speaker.toLowerCase()) ?? cast[i % cast.length];
      return {
        index: i,
        speaker: castMember.name,
        voice: castMember.voice,
        direction: opts.language === "ar" ? "" : sanitizeDirection(s.direction),
        text: s.text.replace(/\[.*?\]/g, "").slice(0, 158),
      };
    })
    .filter((s) => s.text.trim().length > 0);

  const estimated = Math.round(segments.reduce((acc, s) => acc + s.text.split(/\s+/).length, 0) / 1.55); // ~155wpm speech incl. pauses
  return {
    script: { title: data.title, description: data.description, tags: data.tags, hosts: cast.map((c) => ({ name: c.name, role: c.role, voice: c.voice })), segments, estimated_seconds: estimated },
    intel,
    model,
  };
}

const ALLOWED_DIRECTIONS = new Set([
  "cheerful", "friendly", "casual", "warm", "professionally", "authoritatively", "formally", "confidently",
  "whisper", "excited", "dramatic", "deadpan", "serious", "thoughtful", "curious", "somber", "urgent",
  "calm", "singsong", "breathy", "fast paced", "sarcastic", "measured", "empathetic",
]);
function sanitizeDirection(d: string): string {
  const clean = d.replace(/[[\]]/g, "").toLowerCase().trim();
  return ALLOWED_DIRECTIONS.has(clean) ? clean : "";
}

/** Translate an existing script into another language, preserving speaker turns. */
export async function translateScript(script: PodcastScript, targetLanguage: "en" | "ar"): Promise<PodcastScript> {
  const cast = targetLanguage === "ar" ? VOICE_CAST_AR : VOICE_CAST_EN;
  const src = script.segments.map((s) => `${s.index}|${s.speaker}: ${s.text}`).join("\n");
  const { data } = await chatJson<{ lines: { index: number; speaker: string; text: string }[] }>({
    system: `You are a professional broadcast translator. Translate the podcast script into ${targetLanguage === "ar" ? "Modern Standard Arabic (فصحى), natural news-broadcast register" : "English"}. Keep each line short and speakable (<120 chars). Return JSON {"lines":[{"index":n,"speaker":"name","text":"..."}]}. Map speakers to the new cast in order of appearance: ${cast.map((c) => c.name).join(", ")}.`,
    user: src,
    jsonObject: true,
    temperature: 0.3,
    maxTokens: 4000,
  });

  const segments: ScriptSegment[] = data.lines.map((l, i) => {
    const idx = script.segments.findIndex((s) => s.index === l.index);
    const fallback = script.segments[Math.min(i, script.segments.length - 1)];
    const castMember = cast.find((c) => c.name === l.speaker) ?? cast[i % cast.length];
    return {
      index: i,
      speaker: castMember.name,
      voice: castMember.voice,
      direction: targetLanguage === "ar" ? "" : fallback?.direction ?? "",
      text: l.text.slice(0, 158),
      _orig: idx >= 0 ? script.segments[idx] : undefined,
    } as ScriptSegment;
  });
  const estimated = Math.round(segments.reduce((a, s) => a + s.text.split(/\s+/).length, 0) / 1.55);
  return {
    ...script,
    hosts: cast.map((c) => ({ name: c.name, role: c.role, voice: c.voice })),
    segments,
    estimated_seconds: estimated,
  };
}
