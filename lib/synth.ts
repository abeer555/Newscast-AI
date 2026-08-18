import fs from "fs";
import path from "path";
import { kokoroTTS } from "./kokoro";
import { TTS_MODELS } from "./sources";
import { getDb } from "./db";
import { PodcastScript, ScriptLanguage } from "./scriptgen";

const AUDIO_DIR = path.join(process.cwd(), "public", "audio");
// Try to create directory, but don't fail on read-only filesystems (e.g., Vercel)
try {
  if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });
} catch (e) {
  // Read-only filesystem - audio files should already exist in git
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

export async function synthesizeEpisode(opts: {
  episodeId: string;
  script: PodcastScript;
  language: ScriptLanguage;
  onProgress?: (done: number, total: number) => void;
}): Promise<{ audioPath: string | null; durationSec: number; segmentCount: number }> {
  // Validate script has segments
  if (!opts.script.segments || opts.script.segments.length === 0) {
    throw new Error("Cannot synthesize: script has no segments");
  }
  
  // Arabic is not supported by the local Kokoro backend — return early with no audio.
  if (opts.language === "zh") {
    // Chinese works but Kokoro struggles with some characters, allow it for now.
  }

  const buffers: Buffer[] = [];

  // Merge consecutive same-voice segments into ~190-char utterances to minimize API calls.
  // Orpheus cap is 200 chars/call. Packing segments cuts Groq TTS call count 3-5x.
  const merged: { text: string; voice: string }[] = [];
  let cur: { text: string; voice: string } | null = null;
  for (const seg of opts.script.segments) {
    const piece = seg.text; // Kokoro reads out brackets, so we only send the raw text
    if (!seg.text.trim()) continue;
    if (cur && cur.voice === seg.voice) {
      const next = cur.text + (cur.text ? " " : "") + piece;
      if (next.length <= 190) { cur.text = next; continue; }
    }
    if (cur) merged.push(cur);
    cur = { text: piece, voice: seg.voice };
  }
  if (cur && cur.text) merged.push(cur);

  // Final safety: split any still-too-long utterance on sentence boundaries
  const tasks: { text: string; voice: string }[] = [];
  for (const t of merged) {
    if (t.text.length <= 190) tasks.push(t);
    else tasks.push(...chunkForTTS(t.text).map((text) => ({ text, voice: t.voice })));
  }

  if (tasks.length === 0) {
    throw new Error("Cannot synthesize: no text chunks after processing");
  }

  let done = 0;
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    try {
      const buf = await retryTTS(t.text, t.voice, opts.language);
      buffers.push(buf);
    } catch (e) {
      console.error(`[synthesizeEpisode] Failed to synthesize chunk ${i}/${tasks.length}:`, t.text.slice(0, 50));
      throw new Error(`TTS failed on chunk ${i}: ${e instanceof Error ? e.message : e}`);
    }
    done++;
    opts.onProgress?.(done, tasks.length);
    if (done < tasks.length) await new Promise((r) => setTimeout(r, 350));
  }
  
  if (buffers.length === 0) {
    throw new Error("No audio buffers generated - all TTS calls failed");
  }
  
  const combined = concatWavs(buffers);
  const file = `${opts.episodeId}.wav`;
  const full = path.join(AUDIO_DIR, file);
  fs.writeFileSync(full, combined);
  const hdr = parseWavHeader(combined);
  const durationSec = hdr ? (hdr.dataSize / hdr.bytesPerSec) : opts.script.estimated_seconds;
  return { audioPath: `/audio/${file}`, durationSec: Math.round(durationSec * 10) / 10, segmentCount: opts.script.segments.length };
}

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
