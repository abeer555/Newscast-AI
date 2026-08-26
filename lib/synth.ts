/**
 * Voicing, and the timeline that comes out of it.
 *
 * Two things happen here beyond turning text into a WAV.
 *
 * Every utterance is **measured** rather than estimated. Each TTS call returns a
 * standalone WAV, so its exact duration is readable from its own header before the
 * files are concatenated. Accumulating those durations gives a timeline that says
 * precisely when each script line is spoken — which is what lets the player
 * highlight the sentence being read and show the evidence behind it. The old
 * approach of sharing the total runtime out by character count drifts by seconds
 * over a three-minute episode, and a highlight that is confidently wrong is worse
 * than one that admits it is guessing.
 *
 * Every utterance is also **cached by content**. The cache key is a hash of the
 * voice, language and exact text, so re-voicing an episode after editing one line
 * calls the TTS engine for that line alone and reuses the rest byte-for-byte. That
 * is what makes segment-level regeneration cheap: there is no separate code path
 * for it, just a cache that makes the unchanged 95% free.
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { kokoroTTS } from "./kokoro";
import { TTS_MODELS } from "./sources";
import { getDb } from "./db";
import { PodcastScript, ScriptLanguage } from "./scriptgen";

const AUDIO_DIR = path.join(process.cwd(), "public", "audio");
/** Voiced utterances, keyed by content hash, so an edit re-voices only what changed. */
const TTS_CACHE_DIR = path.join(process.cwd(), "data", "tts-cache");

// Try to create directories, but don't fail on read-only filesystems (e.g. Vercel)
for (const dir of [AUDIO_DIR, TTS_CACHE_DIR]) {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch {
    // Read-only filesystem — audio files should already exist in git
  }
}

/** One spoken utterance, with the script lines it carries and where it lands. */
export interface VoicedUtterance {
  start: number;
  end: number;
  text: string;
  voice: string;
  /** Script segment indices voiced by this utterance, in spoken order. */
  segments: number[];
  /** True when this utterance was reused from cache rather than re-voiced. */
  cached: boolean;
}

/** A planned TTS call: the text to voice and the script lines it covers. */
export interface UtterancePlan {
  text: string;
  voice: string;
  segments: number[];
}

/** Split text into <=190-char chunks on sentence/word boundaries (Orpheus hard limit: 200). */
export function chunkForTTS(text: string): string[] {
  if (text.length <= 190) return [text];
  const parts: string[] = [];
  let remaining = text.trim();
  while (remaining.length > 190) {
    let cut = remaining.lastIndexOf(". ", 190);
    if (cut < 80) cut = Math.max(remaining.lastIndexOf(", ", 190), remaining.lastIndexOf(" ", 190));
    if (cut < 80) cut = 190;
    parts.push(remaining.slice(0, cut + 1).trim());
    remaining = remaining.slice(cut + 1).trim();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

async function ttsChunk(text: string, voice: string, language: ScriptLanguage): Promise<Buffer> {
  if (language === "zh" || TTS_MODELS[language] === null) {
    throw new Error("Arabic TTS is not supported with the local Kokoro backend.");
  }
  const model = TTS_MODELS[language] ?? "kokoro/local";
  const start = Date.now();
  const buf = await kokoroTTS({ text, voice, speed: 1.0 });
  try {
    getDb().prepare("INSERT INTO analytics_events (kind, model, latency_ms, meta, created_at) VALUES ('tts_call',?,?,?,?)")
      .run(model, Date.now() - start, JSON.stringify({ chars: text.length, voice }), Date.now());
  } catch { /* non-fatal */ }
  return buf;
}

/** Concatenate WAV buffers (PCM) into one valid WAV. Assumes same format/rate across buffers. */
export function concatWavs(buffers: Buffer[]): Buffer {
  if (buffers.length === 0) throw new Error("No WAV buffers to concatenate");
  if (buffers.length === 1) return buffers[0];
  const datas: Buffer[] = [];
  let fmt: Buffer | null = null;
  let dataSize = 0;
  for (let i = 0; i < buffers.length; i++) {
    const b = buffers[i];
    if (!b || b.length === 0) {
      console.warn(`[concatWavs] Buffer ${i} is empty, skipping`);
      continue;
    }
    const header = parseWavHeader(b);
    if (!header) {
      console.warn(`[concatWavs] Buffer ${i} is not a valid WAV (size: ${b.length} bytes), skipping`);
      console.warn(`[concatWavs] First 20 bytes: ${b.subarray(0, 20).toString('hex')}`);
      continue;
    }
    if (!fmt) fmt = b.subarray(12, header.fmtEnd);
    datas.push(b.subarray(header.dataStart, header.dataStart + header.dataSize));
    dataSize += header.dataSize;
  }
  if (!fmt || datas.length === 0) {
    throw new Error(`No valid WAV segments (got ${buffers.length} buffers, ${datas.length} valid)`);
  }
  const fmtSize = fmt.length;
  const out = Buffer.alloc(12 + 8 + fmtSize + 8 + dataSize);
  out.write("RIFF", 0);
  out.writeUInt32LE(4 + (8 + fmtSize) + (8 + dataSize), 4);
  out.write("WAVE", 8);
  fmt.copy(out, 12);
  out.write("data", 12 + fmtSize);
  out.writeUInt32LE(dataSize, 12 + fmtSize + 4);
  let off = 12 + fmtSize + 8;
  for (const d of datas) { d.copy(out, off); off += d.length; }
  return out;
}

function parseWavHeader(b: Buffer): { fmtEnd: number; dataStart: number; dataSize: number; sampleRate: number; bytesPerSec: number } | null {
  if (b.length < 44 || b.toString("ascii", 0, 4) !== "RIFF") return null;
  let pos = 12;
  let fmtEnd = 0;
  while (pos + 8 <= b.length) {
    const id = b.toString("ascii", pos, pos + 4);
    const size = b.readUInt32LE(pos + 4);
    if (id === "fmt ") fmtEnd = pos + 8 + size;
    if (id === "data") {
      const buf = b.subarray(20, 24);
      const sampleRate = b.readUInt32LE(24);
      const bytesPerSec = b.readUInt32LE(28);
      void buf;
      return { fmtEnd, dataStart: pos + 8, dataSize: Math.min(size, b.length - pos - 8), sampleRate, bytesPerSec };
    }
    pos += 8 + size + (size % 2);
  }
  return null;
}

/** Exact duration of a standalone WAV, in seconds, from its own header. */
export function wavDuration(b: Buffer): number | null {
  const h = parseWavHeader(b);
  if (!h || !h.bytesPerSec) return null;
  return h.dataSize / h.bytesPerSec;
}

/* ------------------------------------------------------------------ *
 * Planning
 * ------------------------------------------------------------------ */

/** Locates each chunk inside its source text, so segment spans can be attributed. */
function spanChunks(text: string, chunks: string[]): { text: string; from: number; to: number }[] {
  let cursor = 0;
  return chunks.map((c) => {
    const at = text.indexOf(c, cursor);
    const from = at >= 0 ? at : cursor;
    const to = from + c.length;
    cursor = to;
    return { text: c, from, to };
  });
}

/**
 * Groups the script into the TTS calls that will actually be made.
 *
 * Consecutive lines by the same voice are merged up to the engine's 190-character
 * limit, because packing cuts the call count several-fold. Each planned call
 * records which script lines it carries — tracked by character span, so a merged
 * utterance that then has to be split back apart still attributes its lines
 * correctly rather than losing them at the seam.
 */
export function planUtterances(script: PodcastScript): UtterancePlan[] {
  interface Draft {
    text: string;
    voice: string;
    spans: { index: number; from: number; to: number }[];
  }

  const drafts: Draft[] = [];
  let cur: Draft | null = null;
  for (const seg of script.segments ?? []) {
    if (!seg.text.trim()) continue;
    const piece = seg.text; // Kokoro reads out brackets, so only the raw text is sent
    if (cur && cur.voice === seg.voice && cur.text.length + 1 + piece.length <= 190) {
      const from = cur.text.length + (cur.text ? 1 : 0);
      cur.text = cur.text + (cur.text ? " " : "") + piece;
      cur.spans.push({ index: seg.index, from, to: cur.text.length });
      continue;
    }
    if (cur) drafts.push(cur);
    cur = { text: piece, voice: seg.voice, spans: [{ index: seg.index, from: 0, to: piece.length }] };
  }
  if (cur && cur.text) drafts.push(cur);

  const plans: UtterancePlan[] = [];
  for (const d of drafts) {
    if (d.text.length <= 190) {
      plans.push({ text: d.text, voice: d.voice, segments: d.spans.map((s) => s.index) });
      continue;
    }
    // Too long even alone: split it, and give each piece the lines it overlaps.
    const pieces = spanChunks(d.text, chunkForTTS(d.text));
    const assigned = new Set<number>();
    const built = pieces.map((p) => {
      const segments = d.spans.filter((s) => s.from < p.to && s.to > p.from).map((s) => s.index);
      segments.forEach((i) => assigned.add(i));
      return { text: p.text, voice: d.voice, segments };
    });
    // A line that fell through a seam is attached to the nearest piece rather than dropped.
    for (const s of d.spans) {
      if (assigned.has(s.index)) continue;
      let best = 0;
      let bestDist = Infinity;
      pieces.forEach((p, k) => {
        const dist = Math.min(Math.abs(p.from - s.from), Math.abs(p.to - s.to));
        if (dist < bestDist) {
          bestDist = dist;
          best = k;
        }
      });
      built[best].segments.push(s.index);
    }
    plans.push(...built.map((b) => ({ ...b, segments: [...new Set(b.segments)].sort((x, y) => x - y) })));
  }
  return plans.filter((p) => p.text.trim().length > 0);
}

/* ------------------------------------------------------------------ *
 * Cache
 * ------------------------------------------------------------------ */

function cacheKey(text: string, voice: string, language: ScriptLanguage): string {
  return crypto.createHash("sha1").update(`${language}|${voice}|${text}`).digest("hex");
}

function readCache(key: string): Buffer | null {
  try {
    const p = path.join(TTS_CACHE_DIR, `${key}.wav`);
    if (!fs.existsSync(p)) return null;
    const buf = fs.readFileSync(p);
    // A truncated cache entry is worse than a miss.
    return parseWavHeader(buf) ? buf : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, buf: Buffer): void {
  try {
    fs.writeFileSync(path.join(TTS_CACHE_DIR, `${key}.wav`), buf);
  } catch {
    /* read-only filesystem — synthesis still succeeds, it just will not be reused */
  }
}

export async function synthesizeEpisode(opts: {
  episodeId: string;
  script: PodcastScript;
  language: ScriptLanguage;
  onProgress?: (done: number, total: number) => void;
}): Promise<{
  audioPath: string | null;
  durationSec: number;
  segmentCount: number;
  timeline: VoicedUtterance[];
  ttsCalls: number;
  cacheHits: number;
}> {
  // Validate script has segments
  if (!opts.script.segments || opts.script.segments.length === 0) {
    throw new Error("Cannot synthesize: script has no segments");
  }

  // Arabic is not supported by the local Kokoro backend — return early with no audio.
  if (opts.language === "zh") {
    // Chinese works but Kokoro struggles with some characters, allow it for now.
  }

  const tasks = planUtterances(opts.script);
  if (tasks.length === 0) {
    throw new Error("Cannot synthesize: no text chunks after processing");
  }

  const buffers: Buffer[] = [];
  const timeline: VoicedUtterance[] = [];
  let cursor = 0;
  let ttsCalls = 0;
  let cacheHits = 0;
  let done = 0;

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const key = cacheKey(t.text, t.voice, opts.language);
    const cached = readCache(key);
    const fromCache = cached !== null;
    let buf: Buffer;
    if (cached) {
      buf = cached;
      cacheHits++;
    } else {
      try {
        buf = await retryTTS(t.text, t.voice, opts.language);
      } catch (e) {
        console.error(`[synthesizeEpisode] Failed to synthesize chunk ${i}/${tasks.length}:`, t.text.slice(0, 50));
        throw new Error(`TTS failed on chunk ${i}: ${e instanceof Error ? e.message : e}`);
      }
      ttsCalls++;
      writeCache(key, buf);
    }

    // Measure this utterance before it is concatenated away.
    const dur = wavDuration(buf);
    if (dur !== null && dur > 0) {
      timeline.push({
        start: Math.round(cursor * 100) / 100,
        end: Math.round((cursor + dur) * 100) / 100,
        text: t.text,
        voice: t.voice,
        segments: t.segments,
        cached: fromCache,
      });
      cursor += dur;
    } else {
      // Unreadable header: keep the audio but do not fabricate a timing for it,
      // which is what marks the whole timeline as unmeasured downstream.
      console.warn(`[synthesizeEpisode] Chunk ${i} has no readable duration; timeline will be partial`);
    }
    buffers.push(buf);

    done++;
    opts.onProgress?.(done, tasks.length);
    // Only pace real engine calls; reused audio should be instant.
    if (done < tasks.length && !fromCache) await new Promise((r) => setTimeout(r, 350));
  }

  if (buffers.length === 0) {
    throw new Error("No audio buffers generated - all TTS calls failed");
  }

  const combined = concatWavs(buffers);
  const file = `${opts.episodeId}.wav`;
  const full = path.join(AUDIO_DIR, file);
  fs.writeFileSync(full, combined);
  const measured = wavDuration(combined);
  const durationSec = measured ?? opts.script.estimated_seconds;

  // Every planned utterance must be timed for the timeline to be trusted.
  const complete = timeline.length === tasks.length;
  return {
    audioPath: `/audio/${file}`,
    durationSec: Math.round(durationSec * 10) / 10,
    segmentCount: opts.script.segments.length,
    timeline: complete ? timeline : [],
    ttsCalls,
    cacheHits,
  };
}

/** Thrown when the requested language has no working TTS backend. */
export class TTSUnsupportedError extends Error {
  constructor(public language: string) {
    super(`TTS is not supported for language: ${language}`);
    this.name = "TTSUnsupportedError";
  }
}

async function retryTTS(text: string, voice: string, language: ScriptLanguage, attempt = 0): Promise<Buffer> {
  try {
    return await ttsChunk(text, voice, language);
  } catch (e) {
    const msg = String(e);
    // Kokoro server temporarily unavailable — back off and retry
    if (/ECONNREFUSED|unreachable|fetch failed/i.test(msg) && attempt < 5) {
      await new Promise((r) => setTimeout(r, 2_000 * (attempt + 1)));
      return retryTTS(text, voice, language, attempt + 1);
    }
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
      return retryTTS(text, voice, language, attempt + 1);
    }
    throw new Error(`TTS failed after ${attempt + 1} attempts: ${e}`);
  }
}
