import { chatJson, LLM_MODELS } from "./chat";
import { PodcastScript } from "./scriptgen";
import { StoryIntelligence } from "./intelligence";

export interface Beat {
  index: number;
  /** rich cinematic image-generation prompt for this beat */
  image_prompt: string;
  negative_prompt: string;
  /** 3-8 word overlay caption */
  caption: string;
  /** seconds on screen, proportional to the narration it covers */
  duration: number;
  /** which script segments this beat covers (inclusive) */
  segment_range: [number, number];
  /** image source metadata for hybrid mode */
  image_source?: "article" | "ai_generated";
  frame_path?: string;
  quality_score?: number;
}

export interface Storyboard {
  style: string;
  aspect: "16:9";
  beats: Beat[];
  total_duration: number;
}

/** One visual identity for the whole show so every beat looks like it belongs to the same film. */
export const STYLE_BLOCK =
  "cinematic editorial news illustration, muted teal-and-amber palette, volumetric light, subtly painterly texture, shallow film grain, wide 16:9 composition, ABSOLUTELY NO text, NO letters, NO words, NO typography of any kind, NO logos, NO watermarks, NO signs";
export const NEGATIVE_BLOCK =
  "text, words, letters, captions, subtitles, headlines, signage, logos, watermarks, ANY typography, low quality, blurry, bad anatomy, extra digits, gore, nsfw, deformed";

export function groupScriptIntoBeats(script: PodcastScript, opts?: { maxBeats?: number }) {
  const wordsPerSeg = script.segments.map((s) => s.text.split(/\s+/).length);
  const totalWords = Math.max(1, wordsPerSeg.reduce((a, b) => a + b, 0));
  const estSeconds = script.estimated_seconds || Math.round(totalWords / 1.55);
  const targetBeats = Math.min(opts?.maxBeats ?? 14, Math.max(6, Math.round(estSeconds / 7)));

  const groups: { segs: number[]; words: number }[] = [];
  const perBeat = totalWords / targetBeats;
  let cur: number[] = [];
  let curWords = 0;
  script.segments.forEach((s, i) => {
    cur.push(i);
    curWords += wordsPerSeg[i];
    if (curWords >= perBeat && groups.length < targetBeats - 1) {
      groups.push({ segs: cur, words: curWords });
      cur = []; curWords = 0;
    }
  });
  if (cur.length) groups.push({ segs: cur, words: curWords });
  return { groups, totalWords, estSeconds };
}

export async function planStoryboard(
  script: PodcastScript,
  intel: StoryIntelligence | null,
  opts?: { maxBeats?: number }
): Promise<Storyboard> {
  const { groups, totalWords, estSeconds } = groupScriptIntoBeats(script, opts);

  const beatLines = groups
    .map((g, i) => `BEAT ${i + 1} (segments ${g.segs[0]}–${g.segs[g.segs.length - 1]}):\n${g.segs.map((j) => script.segments[j].text).join(" ")}`)
    .join("\n\n");

  const { data } = await chatJson<{ beats: { image_prompt: string; caption: string }[] }>({
    model: LLM_MODELS.frontier,
    system:
      `You are the visual director of NEWSCAST AI's video desk. You turn narration into shot prompts for an AI image generator. Rules: each prompt is a single vivid cinematic sentence (35-60 words) describing exactly what is on screen — subject, setting, lighting, mood, lens feel ("wide aerial", "close-up", "tilt-shift"). Imagery must be editorial and respectful: real-world scenes, cities, maps, documents, objects, skies — NEVER gore, NEVER identifiable private individuals; public figures only via symbolic framing ("the Senate chamber", not likenesses). Keep one coherent visual language across all beats: same palette, same time-of-day logic, escalating scale. End every prompt with this style block verbatim: "${STYLE_BLOCK}". Captions: 3-8 punchy words for overlay.`,
    user: `STORY: ${intel?.headline ?? script.title}\nCONTEXT: ${intel?.lede ?? script.description}\n\nThe narration grouped into ${groups.length} beats:\n\n${beatLines}\n\nReturn JSON {"beats":[{"image_prompt":"...","caption":"..."}]} with exactly ${groups.length} beats in order.`,
    jsonObject: true,
    maxTokens: 6000,
    temperature: 0.7,
    task: "storyboard",
  });

  const beats: Beat[] = groups.map((g, i) => {
    const share = g.words / totalWords;
    const duration = Math.min(4.5, Math.max(1.5, Math.round(share * estSeconds * 10) / 10));
    const planned = data.beats[i];
    return {
      index: i,
      image_prompt: planned?.image_prompt ?? `${script.title} editorial illustration, ${STYLE_BLOCK}`,
      negative_prompt: NEGATIVE_BLOCK,
      caption: (planned?.caption ?? "").slice(0, 64),
      duration,
      segment_range: [g.segs[0], g.segs[g.segs.length - 1]],
    };
  });

  // normalize total on-screen time to the narration estimate
  const totalPlanned = beats.reduce((a, b) => a + b.duration, 0);
  const scale = estSeconds / Math.max(0.1, totalPlanned);
  let acc = 0;
  for (const b of beats) { b.duration = Math.max(1.2, Math.round(b.duration * scale * 10) / 10); acc += b.duration; }

  return { style: STYLE_BLOCK, aspect: "16:9", beats, total_duration: Math.round(acc * 10) / 10 };
}

export function planStoryboardFromArticles(
  script: PodcastScript,
  imageUrls: string[],
  opts?: { maxBeats?: number }
): Storyboard {
  const { groups, totalWords, estSeconds } = groupScriptIntoBeats(script, opts);
  
  const beats: Beat[] = groups.map((g, i) => {
    const share = g.words / totalWords;
    const duration = Math.min(4.5, Math.max(1.5, Math.round(share * estSeconds * 10) / 10));
    const firstSegment = script.segments[g.segs[0]]?.text || "";
    const caption = firstSegment.split(/\s+/).slice(0, 5).join(" ").slice(0, 64);
    // Determine which image to use (cycle if we have fewer images than beats)
    const imgIndex = imageUrls.length > 0 ? i % imageUrls.length : 0;
    const framePath = imageUrls.length > 0 ? imageUrls[imgIndex] : "";
    
    return {
      index: i,
      image_prompt: "",
      negative_prompt: "",
      caption,
      duration,
      segment_range: [g.segs[0], g.segs[g.segs.length - 1]],
      frame_path: framePath,
      image_source: (framePath && i < imageUrls.length) ? "article" : "ai_generated", // Mark source
    } as Beat & { frame_path: string };
  });

  const totalPlanned = beats.reduce((a, b) => a + b.duration, 0);
  const scale = estSeconds / Math.max(0.1, totalPlanned);
  let acc = 0;
  for (const b of beats) { b.duration = Math.max(1.2, Math.round(b.duration * scale * 10) / 10); acc += b.duration; }

  return { style: "article_images", aspect: "16:9", beats, total_duration: Math.round(acc * 10) / 10 };
}


/** Per-segment timestamps from real audio, so captions switch exactly when the voice moves on. */
export function segmentTimeline(script: PodcastScript, totalAudioSec: number): { start: number; end: number; text: string; speaker: string }[] {
  const weights = script.segments.map((s) => Math.max(1, s.text.split(/\s+/).length));
  const total = weights.reduce((a, b) => a + b, 0);
  let t = 0;
  return script.segments.map((s, i) => {
    const dur = (weights[i] / total) * totalAudioSec;
    const row = { start: Math.round(t * 100) / 100, end: Math.round((t + dur) * 100) / 100, text: s.text, speaker: s.speaker };
    t += dur;
    return row;
  });
}
