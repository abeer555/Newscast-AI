import fs from "fs";
import path from "path";
import { groq } from "./groq";
import { TTS_MODELS } from "./sources";
import { getDb } from "./db";
import { PodcastScript } from "./scriptgen";

const AUDIO_DIR = path.join(process.cwd(), "public", "audio");
if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });

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

async function ttsChunk(text: string, voice: string, language: "en" | "ar"): Promise<Buffer> {
  const model = TTS_MODELS[language];
  const start = Date.now();
  let res: Awaited<ReturnType<typeof groq.prototype.audio.speech.create>>;
  try {
    res = await groq().audio.speech.create({ model, voice, input: text, response_format: "wav" });
  } catch (e) {
    // Arabic pool shares the daily budget on this key — fall back to the English voice model so Arabic episodes still ship audio
    if (language === "ar" && String(e).includes("model_terms_required")) {
      res = await groq().audio.speech.create({ model: TTS_MODELS.en, voice: "hannah", input: text, response_format: "wav" });
    } else {
      throw e;
    }
  }
  const buf = Buffer.from(await res.arrayBuffer());
  try {
    getDb().prepare("INSERT INTO analytics_events (kind, model, latency_ms, meta, created_at) VALUES ('tts_call',?,?,?,?)")
      .run(model, Date.now() - start, JSON.stringify({ chars: text.length, voice }), Date.now());
  } catch { /* non-fatal */ }
  return buf;
}

/** Concatenate WAV buffers (PCM) into one valid WAV. Assumes same format/rate across buffers. */
export function concatWavs(buffers: Buffer[]): Buffer {
  if (buffers.length === 1) return buffers[0];
  const datas: Buffer[] = [];
  let fmt: Buffer | null = null;
  let dataSize = 0;
  for (const b of buffers) {
    const header = parseWavHeader(b);
    if (!header) continue;
    if (!fmt) fmt = b.subarray(12, header.fmtEnd);
    datas.push(b.subarray(header.dataStart, header.dataStart + header.dataSize));
    dataSize += header.dataSize;
  }
  if (!fmt) throw new Error("No valid WAV segments");
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
  language: "en" | "ar";
  onProgress?: (done: number, total: number) => void;
}): Promise<{ audioPath: string; durationSec: number; segmentCount: number }> {
  const buffers: Buffer[] = [];
  const tasks: { text: string; voice: string }[] = [];
  for (const seg of opts.script.segments) {
    const input = seg.direction && opts.language === "en" ? `[${seg.direction}] ${seg.text}` : seg.text;
    for (const chunk of chunkForTTS(input)) tasks.push({ text: chunk, voice: seg.voice });
  }
  let done = 0;
  for (const t of tasks) {
    const buf = await retryTTS(t.text, t.voice, opts.language);
    buffers.push(buf);
    done++;
    opts.onProgress?.(done, tasks.length);
    // gentle pacing to respect the on-demand TPD budget
    if (done < tasks.length) await new Promise((r) => setTimeout(r, 350));
  }
  const combined = concatWavs(buffers);
  const file = `${opts.episodeId}.wav`;
  const full = path.join(AUDIO_DIR, file);
  fs.writeFileSync(full, combined);
  const hdr = parseWavHeader(combined);
  const durationSec = hdr ? (hdr.dataSize / hdr.bytesPerSec) : opts.script.estimated_seconds;
  return { audioPath: `/audio/${file}`, durationSec: Math.round(durationSec * 10) / 10, segmentCount: opts.script.segments.length };
}

export class TTSTermsError extends Error {
  constructor(public modelId: string) {
    super(`TERMS_REQUIRED:${modelId}`);
    this.name = "TTSTermsError";
  }
}

async function retryTTS(text: string, voice: string, language: "en" | "ar", attempt = 0): Promise<Buffer> {
  try {
    return await ttsChunk(text, voice, language);
  } catch (e) {
    const msg = String(e);
    // terms acceptance is not retryable — surface it fast and distinctly
    if (msg.includes("model_terms_required") || msg.includes("requires terms acceptance")) {
      const m = msg.match(/model `([^`]+)`/) ?? msg.match(/model=([a-z0-9%/-]+)/i);
      throw new TTSTermsError(m?.[1] ?? TTS_MODELS[language]);
    }
    // Rate limit: honor the retry window (parse "try again in Xs" / "XmYs")
    const rl = msg.match(/try again in (?:(\d+)m)?\s*(?:([\d.]+)s)?/i);
    if (/rate limit|429|tokens per day/i.test(msg) && attempt < 14) {
      let wait = 20_000;
      if (rl) wait = Math.min(5 * 60_000, (parseInt(rl[1] ?? "0") * 60 + parseFloat(rl[2] ?? "20")) * 1000 + 1500);
      await new Promise((r) => setTimeout(r, wait));
      return retryTTS(text, voice, language, attempt + 1);
    }
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
      return retryTTS(text, voice, language, attempt + 1);
    }
    throw new Error(`TTS failed after ${attempt + 1} attempts: ${e}`);
  }
}
