/**
 * Video renderer — turns a storyboard + narration WAV into a broadcast MP4.
 *
 * Design (ffmpeg-only, no extra deps):
 *   per beat   : slow zoom-in ("Ken Burns") from a 1280x720 Z-Image frame
 *   between    : 0.6s crossfades via xfade
 *   subtitles  : speaker-colored, timed to the real audio via libass (HarfBuzz
 *                shapes Devanagari/Arabic correctly, so Hindi doesn't render as
 *                boxes) — exactly ONE subtitle track, no duplicate lower-third.
 *   audio      : the episode WAV is the master clock — video length snaps to it
 *   encode     : h264 yuv420p aac → <video> plays everywhere
 */
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import type { Storyboard } from "./storyboard";
import { segmentTimeline } from "./storyboard";
import type { PodcastScript } from "./scriptgen";

const run = promisify(execFile);
const VIDEO_DIR = path.join(process.cwd(), "public", "video");
// Try to create directory, but don't fail on read-only filesystems (e.g., Vercel)
try {
  if (!fs.existsSync(VIDEO_DIR)) fs.mkdirSync(VIDEO_DIR, { recursive: true });
} catch (e) {
  // Read-only filesystem - video files should already exist in git
}

const FADE = 0.6;

const LATIN_FONT_DIR = "/usr/share/fonts/TTF:/usr/share/fonts/truetype/dejavu:/usr/share/fonts/dejavu";
const FONT_DIR = "/usr/share/fonts/noto:/usr/share/fonts/noto-cjk:/usr/share/fonts/TTF:/usr/share/fonts/truetype/dejavu:/usr/share/fonts/dejavu";

const FONT_CANDIDATES: { fam: string; files: string[] }[] = [
  {
    fam: "Noto Sans Devanagari",
    files: [
      "/usr/share/fonts/noto/NotoSansDevanagari-SemiBold.ttf",
      "/usr/share/fonts/noto/NotoSansDevanagari-Medium.ttf",
      "/usr/share/fonts/noto/NotoSansDevanagari-Regular.ttf",
    ],
  },
  {
    fam: "Noto Sans",
    files: [
      "/usr/share/fonts/noto/NotoSans-SemiBold.ttf",
      "/usr/share/fonts/noto/NotoSans-Medium.ttf",
      "/usr/share/fonts/noto/NotoSans-Regular.ttf",
      "/usr/share/fonts/noto/NotoSans-Bold.ttf",
      "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
      "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
      "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
    ],
  },
];
const FONT_NAMES = ["Noto Sans", "Noto Sans Devanagari", "Noto Sans Arabic", "Noto Sans Hebrew", "Noto Sans Thai", "Noto Sans Bengali", "Noto Sans Gurmukhi", "Noto Sans Telugu", "Noto Sans Kannada", "Noto Sans Malayalam", "Noto Sans Tamil", "Noto Sans Khmer", "Noto Sans CJK SC", "DejaVu Sans"];

/** Find a font file that actually covers the script's characters. */
function findFontForText(text: string): { file: string; family: string } | null {
  const needs = FONT_CANDIDATES.map((c) => ({ ...c, file: c.files.find((f) => fs.existsSync(f)) })).filter((c) => c.file) as { fam: string; file: string }[];
  if (needs.length === 0) return null;
  const devanagari = /[\u0900-\u097F\uA8E0-\uA8FF]/.test(text);
  const chinese = /[\u4E00-\u9FFF\u3400-\u4DBF]/.test(text);
  const arabic = /[\u0590-\u08FF]/.test(text);
  const cjkzh = FONT_NAMES.find((f) => f.includes("CJK SC"));
  if (chinese && cjkzh) return { family: cjkzh, file: "/usr/share/fonts/noto-cjk/NotoSansCJKsc-Regular.otf" };
  // fall back to the first family whose file exists
  if (devanagari) {
    const dn = needs.find((c) => c.fam.includes("Devanagari"));
    if (dn) return dn;
  }
  const generic = needs.find((c) => c.fam === "Noto Sans") ?? needs[0];
  return generic;
}

function findRenderFont(script: PodcastScript): { family: string; file: string } {
  const text = script.segments.map((s) => s.text).join(" ");
  const found = findFontForText(text);
  if (found) return found;
  return {
    family: "DejaVu Sans",
    file: "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  };
}

/** Escape a string for embedding inside an ASS subtitle line. */
function assText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\N")
    .replace(/\r/g, "")
    .replace(/\t/g, " ");
}

/** Convert seconds to ASS timestamp `H:MM:SS.cc`. */
function assTime(sec: number): string {
  const ms = Math.round(Math.max(0, sec) * 100);
  const h = Math.floor(ms / 360000);
  const m = Math.floor((ms % 360000) / 6000);
  const s = Math.floor((ms % 6000) / 100);
  const c = ms % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

/** Build a libass subtitle file with per-speaker colored, correctly-shaped text. */
function buildAssSubtitles(opts: {
  script: PodcastScript;
  audioSec: number;
  width: number;
  height: number;
  fontFamily: string;
  file: string;
}): string {
  const subs = segmentTimeline(opts.script, opts.audioSec);
  const speakers = Array.from(new Set(opts.script.segments.map((s) => s.speaker)));
  // libass colours are &H AABBGGRR — alpha first, then blue, green, red.
  const palette = ["&H00F9D366", "&H00E8D38F", "&H005483EF", "&H00C0F2B8", "&H008E8CF5"];

  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: " + opts.width,
    "PlayResY: " + opts.height,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Sub,${opts.fontFamily},26,&H00FFFFFF,&H00000000,&H80000000,0,2,0,2,24,24,96,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];

  const lines = subs.map((s) => {
    const color = palette[Math.max(0, speakers.indexOf(s.speaker)) % palette.length];
    const text = assText(s.text.slice(0, 150));
    return `Dialogue: 0,${assTime(s.start)},${assTime(s.end)},Sub,,0,0,0,,{\\1c${color}}${text}`;
  });

  const content = header.join("\n") + "\n" + lines.join("\n") + "\n";
  fs.writeFileSync(opts.file, content);
  return opts.file;
}

export interface RenderOpts {
  episodeId: string;
  storyboard: Storyboard;
  frames: string[]; // absolute paths, one per beat
  audioPath: string; // absolute path to episode wav
  audioDuration: number;
  script: PodcastScript;
  isReel?: boolean; // if true, render 1080x1920 vertical for social reels
  onProgress?: (pct: number, label: string) => void;
}

export async function renderEpisodeVideo(opts: RenderOpts): Promise<{ filePath: string; publicPath: string; durationSec: number }> {
  const W = opts.isReel ? 1080 : 1280;
  const H = opts.isReel ? 1920 : 720;
  const FPS = 24;
  const framesDir = path.join(VIDEO_DIR, "tmp", opts.episodeId);
  // fresh workspace (stale xfade intermediates caused pinned first-beat bugs in the past)
  try { fs.rmSync(framesDir, { recursive: true, force: true }); } catch { /* first run */ }
  try {
    fs.mkdirSync(framesDir, { recursive: true });
  } catch (e) {
    // Read-only filesystem - skip video generation on demo platform
    throw new Error("Video generation not available on read-only platform (demo mode)");
  }

  const board = opts.storyboard;
  const n = board.beats.length;
  if (opts.frames.length !== n) throw new Error(`frames(${opts.frames.length}) != beats(${n})`);

  // --- rescale beat durations onto the REAL audio length (audio is master clock).
  // Every fade overlaps FADE seconds between two beats, so the total timeline is
  // sum(frameDur) - (n-1)*FADE. Solve for the scale factor so the video ends exactly
  // when the audio ends (with a half-fade of tail so it doesn't hard-cut).
  const audioSec = Math.max(2, opts.audioDuration);
  const bTotal = board.beats.reduce((a, b) => a + b.duration, 0);
  const scale = (audioSec + (n - 1) * FADE + 0.3) / bTotal;
  const frameDur = board.beats.map((b) => Math.max(1.0, Math.round(b.duration * scale * 100) / 100));

  opts.onProgress?.(0.55, "Building Ken Burns clips");

  // --- pass 1: per-beat smooth Ken Burns
  // Zoompan snaps x/y to integer offsets → 1px frame-to-frame jitter at 720p. Run it on an
  // OVERSIZED canvas (≈4x output) so its integer hops become 0.25 output-pixels (invisible),
  // then scale down once with lanczos.
  const clipPaths: string[] = [];
  for (let i = 0; i < n; i++) {
    const out = path.join(framesDir, `clip_${String(i).padStart(3, "0")}.mp4`);
    const frames = Math.max(8, Math.ceil(frameDur[i] * FPS));
    const dir = i % 2 === 0 ? 1 : -1;
    const Z0 = 1.0, Z1 = 1.18;
    const zExpr = dir > 0 ? `${Z0}+(${Z1 - Z0})*on/${frames}` : `${Z1}+(${Z0 - Z1})*on/${frames}`;
    await run("ffmpeg", [
      "-y",
      "-loop", "1",
      "-framerate", String(FPS),
      "-i", opts.frames[i],
      "-vf",
      [
        // For reels (portrait), crop 9:16 centre; for landscape crop 16:9
        opts.isReel
          ? "crop='min(iw,ih*9/16)':'min(ih,iw*16/9)'"
          : "crop='min(iw,ih*16/9)':'min(ih,iw*9/16)'",
        opts.isReel ? "scale=4320:7680:flags=lanczos" : "scale=5120:2880:flags=lanczos",
        `zoompan=z='${zExpr}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=1:s=${W}x${H}:fps=${FPS}`,
        "format=yuv420p",
        "setsar=1",
      ].join(","),
      "-frames:v", String(frames),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
      out,
    ], { timeout: 300_000 });
    // sanity: ensure the produced clip matches its beat budget so a broken zoompan fails fast
    try {
      const probe = await run("ffprobe", ["-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", out]);
      const got = parseFloat(probe.stdout.trim());
      if (Math.abs(got - frameDur[i]) > 0.5) {
        console.warn(`[video] clip ${i} length drift: expected ${frameDur[i].toFixed(2)}s, got ${got.toFixed(2)}s`);
      }
    } catch { /* non-fatal */ }
    clipPaths.push(out);
    opts.onProgress?.(0.55 + 0.15 * ((i + 1) / n), `Clip ${i + 1}/${n}`);
  }

  // --- final graph: each clip is its OWN INPUT (concat-demuxer with -c copy produces
  // stale mpeg-4 timestamps which makes xfade pin the first beat — so we skip concat and
  // xfade across inputs directly).
  opts.onProgress?.(0.72, "Crossfades & subtitles");

  const fc: string[] = [];

  // xfade expects each input already SHIFTED so its frame-0 PTS equals the offset.
  // Pre-shift every input with setpts, then chain xfades that transition at those times.
  let offset = 0;
  const offsets: number[] = [0];
  for (let i = 1; i < n; i++) {
    offset += frameDur[i - 1] - FADE;
    offsets.push(offset);
  }
  for (let i = 1; i < n; i++) {
    fc.push(`[${i}:v]setpts=PTS+${offsets[i].toFixed(3)}/TB[sh${i}]`);
  }
  let last = "0:v";
  for (let i = 1; i < n; i++) {
    const out = `x${i}`;
    fc.push(`[${last}][sh${i}]xfade=transition=fade:duration=${FADE}:offset=${offsets[i].toFixed(3)}[${out}]`);
    last = out;
  }

  // ONE correctly-shaped subtitle track (speaker subtitles only — no duplicate lower-third).
  const renderFont = findRenderFont(opts.script);
  const assPath = path.join(framesDir, "subs.ass");
  buildAssSubtitles({
    script: opts.script,
    audioSec,
    width: W,
    height: H,
    fontFamily: renderFont.family,
    file: assPath,
  });
  // libass does HarfBuzz shaping: Devanagari/Arabic render as real glyphs, not boxes.
  const fontsdir = path.dirname(renderFont.file);
  fc.push(`[${last}]subtitles=filename='${assPath}':fontsdir='${fontsdir}':force_style='Fontname=${renderFont.family},FontsDir=${fontsdir}'[subbed]`);
  last = "subbed";

  fc.push(`[${last}]format=yuv420p[vout]`);

  const filterPath = path.join(framesDir, "graph.ff");
  fs.writeFileSync(filterPath, fc.join(";\n"));

  const outFile = `${opts.episodeId}.mp4`;
  const outPath = path.join(VIDEO_DIR, outFile);
  opts.onProgress?.(0.85, "Encoding final MP4");
  const audioInputIdx = clipPaths.length;
  try {
    await run("ffmpeg", [
      "-y",
      ...clipPaths.flatMap((p) => ["-i", p]),
      "-i", opts.audioPath,
      "-/filter_complex", filterPath,
      "-map", "[vout]",
      "-map", `${audioInputIdx}:a`,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "160k",
      // cap at the audio's length instead of -shortest (aac+audio drift made -shortest truncate to ~1 clip)
      "-t", audioSec.toFixed(3),
      "-movflags", "+faststart",
      outPath,
    ], { timeout: 600_000, maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    throw new Error(`ffmpeg render failed: ${(err.stderr ?? err.message ?? String(e)).slice(-1200)}`);
  }

  // duration from the container (source of truth)
  let durationSec = audioSec;
  try {
    const probe = await run("ffprobe", ["-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", outPath]);
    durationSec = Math.round(parseFloat(probe.stdout.trim()) * 10) / 10 || audioSec;
  } catch { /* keep estimate */ }

  // cleanup intermediates unless KEEP_TMP is set (handy for debugging filter graphs)
  if (!process.env.KEEP_TMP) {
    try { fs.rmSync(framesDir, { recursive: true, force: true }); } catch { /* non-fatal */ }
  }

  opts.onProgress?.(0.95, "Video ready");
  return { filePath: outPath, publicPath: `/video/${outFile}`, durationSec };
}
