import { getDb } from "./db";
import { analyzeCluster, StoryIntelligence } from "./intelligence";
import { chatJson } from "./chat";

export interface ScriptSegment {
  index: number;
  speaker: string;
  voice: string;
  direction: string; // vocal direction for Kokoro, e.g. "[warm]" — empty string for none
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
  { name: "Heart", voice: "af_heart", role: "host" },
  { name: "Adam", voice: "am_adam", role: "analyst" },
];
const VOICE_CAST_HI = [
  { name: "Priya", voice: "hf_alpha", role: "host" },
  { name: "Arjun", voice: "hm_omega", role: "analyst" },
];
const VOICE_CAST_ES = [
  { name: "Dora", voice: "ef_dora", role: "host" },
  { name: "Alex", voice: "em_alex", role: "analyst" },
];
const VOICE_CAST_FR = [
  { name: "Siwis", voice: "ff_siwis", role: "host" },
  { name: "Sylvie", voice: "ff_siwis", role: "analyst" },
];
const VOICE_CAST_PT = [
  { name: "Dora", voice: "pf_dora", role: "host" },
  { name: "Alex", voice: "pm_alex", role: "analyst" },
];
const VOICE_CAST_ZH = [
  { name: "Xiaobei", voice: "zf_xiaobei", role: "host" },
  { name: "Yunxi", voice: "zm_yunxi", role: "analyst" },
];

export type ScriptLanguage = "en" | "hi" | "es" | "fr" | "pt" | "zh";

export const LANGUAGE_META: Record<ScriptLanguage, { label: string; nativeName: string; cast: typeof VOICE_CAST_EN; instruction: string }> = {
  en: { label: "English", nativeName: "English", cast: VOICE_CAST_EN, instruction: "Write the ENTIRE script in natural broadcast English." },
  hi: { label: "Hindi", nativeName: "हिन्दी", cast: VOICE_CAST_HI, instruction: "Write the ENTIRE script in natural broadcast Hindi (Devanagari). Use a mix of Hindi and English for technical terms (Hinglish is acceptable where natural). Crisp, modern Hindi newsroom style." },
  es: { label: "Spanish", nativeName: "Español", cast: VOICE_CAST_ES, instruction: "Write the ENTIRE script in natural broadcast Spanish (Latin American neutral accent). Clear, modern newsroom style." },
  fr: { label: "French", nativeName: "Français", cast: VOICE_CAST_FR, instruction: "Write the ENTIRE script in natural broadcast French. Clear, modern newsroom style." },
  pt: { label: "Portuguese", nativeName: "Português", cast: VOICE_CAST_PT, instruction: "Write the ENTIRE script in natural Brazilian Portuguese (PT-BR). Clear, modern newsroom style." },
  zh: { label: "Chinese", nativeName: "中文", cast: VOICE_CAST_ZH, instruction: "Write the ENTIRE script in natural Mandarin Chinese (Simplified). Clear, modern newsroom style. Direction field must be an EMPTY string." },
};

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
              direction: { type: "string", description: "single Kokoro vocal direction like cheerful or empty string" },
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

export type EpisodeFormat = "briefing" | "deepdive" | "debate" | "video" | "reel";

const FORMAT_SPECS: Record<EpisodeFormat, { segs: string; brief: string }> = {
  briefing: { segs: "14-18", brief: "a tight 90-second morning briefing: hook the listener instantly, deliver the 5 essential facts with momentum, one line of context, crisp sign-off. Energetic pacing." },
  deepdive: { segs: "22-30", brief: "a 3-minute analytical deep-dive: set the scene, walk through what happened, why it matters, how different outlets are framing it, what to watch next. Thoughtful, authoritative." },
  debate: { segs: "20-26", brief: "a spirited but respectful two-host exchange: present the story, then have the hosts naturally explore different angles and tensions (e.g. optimistic vs skeptical readings), converging on what's solid. Conversational chemistry." },
  video: { segs: "90-120", brief: "a comprehensive 10-15 minute documentary-style deep-dive: expansive introduction, deep historical context, extensive multi-angle analysis, pacing suited for a longer visual format. Highly detailed, authoritative, and narrative-driven." },
  reel: { segs: "6-10", brief: "a punchy 30-60 second vertical reel: one killer hook in the first line, deliver the single most shocking or important fact, a quick 'why it matters', and a CTA close. Fast, bold, social-native." },
};

export async function generateScript(opts: {
  clusterId: string;
  format: EpisodeFormat;
  language: ScriptLanguage;
  style: string;
  critique?: string[];
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

  const langMeta = LANGUAGE_META[opts.language as ScriptLanguage] ?? LANGUAGE_META.en;
  const cast = langMeta.cast;
  const castBlock = cast.map((c) => `${c.name} (${c.role})`).join(", ");
  const spec = FORMAT_SPECS[opts.format];
  const srcList = articles.map((a) => `${a.source_name}: "${a.title}"`).join("; ");

  const langInstruction = `${langMeta.instruction}${
    opts.language !== "zh" ? " The direction field may contain ONE short Kokoro vocal direction (e.g. cheerful, warm, serious, thoughtful, curious) or be an empty string; vary it naturally." : ""
  }`;

  const prompt = `STORY INTELLIGENCE DOSSIER (source material in English — your script must be written natively in ${langMeta.label}, not translated):
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

${opts.critique?.length ? `
⚠️ EDITOR-IN-CHIEF CRITIQUE (Previous draft failed quality review - you MUST address ALL points below):
${opts.critique.map((c, i) => `${i + 1}. ${c}`).join("\n")}

Write a NEW script that directly addresses every critique point above. Be specific and concrete.
` : `Write ${spec.brief}`}

Format: NEWSCAST AI audio show "${opts.format}" — two speakers: ${castBlock}. Alternate speakers naturally; the host drives, the analyst adds depth. Reference that sources were cross-checked where relevant. Factual, vivid, human. NEVER invent facts not in the dossier.
Constraints: EXACTLY ${spec.segs} segments. Each segment text is 1-2 short sentences and MUST be under 120 characters (it feeds a text-to-speech engine with a hard limit).
Title: punchy episode title (≤70 chars). Description: 1 sentence. Tags: 3-5 lowercase topics.
${langInstruction}
Speaker field must be exactly one of: ${cast.map((c) => c.name).join(", ")}.`;

  const { data, model } = await chatJson<{ title: string; description: string; tags: string[]; segments: { speaker: string; direction: string; text: string }[] }>({
    system: "You are the head podcast writer at NEWSCAST AI, producing scripts performed by AI voices. You write for the ear: short sentences, no lists, no URLs, natural spoken flow with light chemistry between hosts.",
    user: prompt,
    jsonSchema: scriptSchema(30),
    maxTokens: opts.format === "video" ? 16000 : 5000,
    temperature: 0.75,
  });
  const MIN_VIDEO_SEGS = 70;

  let allRawSegs = data.segments ?? [];

  // For video format: if the first pass came back short, make a second "continuation" call
  if (opts.format === "video" && allRawSegs.length < MIN_VIDEO_SEGS) {
    const soFarText = allRawSegs
      .map((s, i) => `[${i + 1}] ${s.speaker ?? "?"}: ${s.text ?? ""}`)
      .join("\n");

    const { data: cont } = await chatJson<{ segments: { speaker: string; direction: string; text: string }[] }>({
      system: "You are the head podcast writer at NEWSCAST AI continuing a long-form documentary episode script. Only output the REMAINING segments as a JSON object with a 'segments' array. Do NOT repeat or summarise already-written segments. Pick up exactly where the script left off.",
      user: `ORIGINAL PROMPT CONTEXT:\n${prompt}\n\nSCRIPT SO FAR (${allRawSegs.length} segments — CONTINUE FROM SEGMENT ${allRawSegs.length + 1}):\n${soFarText}\n\nWrite the remaining segments to reach at least ${MIN_VIDEO_SEGS} total segments (ideally 90-120). Output ONLY a JSON object: {"segments":[{"speaker":"...","direction":"...","text":"..."},...]}`,
      jsonObject: true,
      maxTokens: 16000,
      temperature: 0.75,
      task: "video_continuation",
    });

    if (Array.isArray(cont.segments) && cont.segments.length > 0) {
      allRawSegs = [...allRawSegs, ...cont.segments];
    }
  }

  const segments: ScriptSegment[] = allRawSegs
    .filter((s) => s && typeof s === "object")
    .map((s, i) => {
      const castMember = cast.find((c) => c.name.toLowerCase() === (s.speaker || "").toLowerCase()) ?? cast[i % cast.length];
      const rawText = String(s.text ?? "");
      return {
        index: i,
        speaker: castMember.name,
        voice: castMember.voice,
        direction: opts.language === "zh" ? "" : sanitizeDirection(s.direction),
        text: rawText.replace(/\[.*?\]/g, "").slice(0, 158),
      };
    })
    .filter((s) => s.text.trim().length > 0);

  // Validate that we have actual content to synthesize
  if (segments.length === 0) {
    console.error("[generateScript] No valid segments generated from LLM output");
    console.error("[generateScript] Raw segments:", JSON.stringify(allRawSegs.slice(0, 3), null, 2));
    throw new Error(`Script generation failed: no valid segments (got ${allRawSegs.length} raw segments, 0 after filtering)`);
  }

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
function sanitizeDirection(d: string | undefined | null): string {
  if (!d) return "";
  const clean = String(d).replace(/[[\]]/g, "").toLowerCase().trim();
  return ALLOWED_DIRECTIONS.has(clean) ? clean : "";
}

/** Translate an existing script into another language, preserving speaker turns. */
export async function translateScript(script: PodcastScript, targetLanguage: ScriptLanguage): Promise<PodcastScript> {
  const langMeta = LANGUAGE_META[targetLanguage] ?? LANGUAGE_META.en;
  const cast = langMeta.cast;
  const src = script.segments.map((s) => `${s.index}|${s.speaker}: ${s.text}`).join("\n");
  const { data } = await chatJson<{ lines: { index: number; speaker: string; text: string }[] }>({
    system: `You are a professional broadcast translator. Translate the podcast script into ${langMeta.nativeName}, natural news-broadcast register. Keep each line short and speakable (<120 chars). Return JSON {"lines":[{"index":n,"speaker":"name","text":"..."}]}. Map speakers to the new cast in order of appearance: ${cast.map((c: any) => c.name).join(", ")}.`,
    user: src,
    jsonObject: true,
    temperature: 0.3,
    maxTokens: 4000,
  });

  const segments: ScriptSegment[] = data.lines.map((l, i) => {
    const idx = script.segments.findIndex((s) => s.index === l.index);
    const fallback = script.segments[Math.min(i, script.segments.length - 1)];
    const castMember = cast.find((c: any) => c.name === l.speaker) ?? cast[i % cast.length];
    return {
      index: i,
      speaker: castMember.name,
      voice: castMember.voice,
      direction: targetLanguage === "zh" ? "" : fallback?.direction ?? "",
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
