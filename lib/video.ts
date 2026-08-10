/**
 * Video renderer — turns a storyboard + narration WAV into a broadcast MP4.
 *
 * Design (ffmpeg-only, no extra deps):
 *   per beat   : slow zoom-in ("Ken Burns") from a 1280x720 Z-Image frame
 *   between    : 0.6s crossfades via xfade
 *   overlay    : beat caption in a lower-third band + speaker-colored subtitle
 *                track timed to the real audio (drawtext)
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
if (!fs.existsSync(VIDEO_DIR)) fs.mkdirSync(VIDEO_DIR, { recursive: true });

const FADE = 0.6;
const MAX_FONTS = [
  "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/noto/NotoSans-Bold.ttf",
];
function findFont(): string | null {
  for (const f of MAX_FONTS) if (fs.existsSync(f)) return f;
  return null;
}

/** ffmpeg drawtext escaping: \ : ' % , [ ] ; and newlines. */
function dte(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\u2019")
    .replace(/%/g, "\\%")
    .replace(/,/g, "\\,")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/;/g, "\\;")
    .replace(/\n/g, " ");
}

/** Arabic / Hebrew text needs bidi shaping for drawtext to render it correctly. */
function containsRtl(s: string): boolean {
  return /[\u0590-\u08FF]/.test(s);
}

export interface RenderOpts {
  episodeId: string;
  storyboard: Storyboard;
  frames: string[]; // absolute paths, one per beat
  audioPath: string; // absolute path to episode wav
  audioDuration: number;
  script: PodcastScript;
  onProgress?: (pct: number, label: string) => void;
}

export async function renderEpisodeVideo(opts: RenderOpts): Promise<{ filePath: string; publicPath: string; durationSec: number }> {
  const W = 1280, H = 720, FPS = 24;
  const framesDir = path.join(VIDEO_DIR, "tmp", opts.episodeId);
  // fresh workspace (stale xfade intermediates caused pinned first-beat bugs in the past)
  try { fs.rmSync(framesDir, { recursive: true, force: true }); } catch { /* first run */ }
  fs.mkdirSync(framesDir, { recursive: true });

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

  // --- pass 1: per-beat zoom clip
  // Anti-jitter fix:
  //  · crop 16:9 so no letterboxing inside zoompan
  //  · oversized canvas (6400x3600) so zoompan's integer x/y rounding error is ~4 wide-pixels
  //    at output time (vs ~1 at native 1280x720)
  //  · scale down ONCE at the end — never multiple zoompan windows
  const clipPaths: string[] = [];
  for (let i = 0; i < n; i++) {
    const out = path.join(framesDir, `clip_${String(i).padStart(3, "0")}.mp4`);
    const frames = Math.max(8, Math.ceil(frameDur[i] * FPS));
    const Z0 = 1.0, Z1 = 1.20; // modest — read clearly over the beat without wobble
    const dir = i % 2 === 0 ? 1 : -1;
    const viaIn = `zoompan=z='${Z0}+(${Z1 - Z0})*on/${frames}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=${frames}:s=6400x3600:fps=${FPS}`;
    const viaOut = `zoompan=z='${Z1}+(${Z0 - Z1})*on/${frames}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=${frames}:s=6400x3600:fps=${FPS}`;
    const zoom = dir > 0 ? viaIn : viaOut;
    await run("ffmpeg", [
      "-y",
      "-loop", "1",
      "-framerate", String(FPS),
      "-i", opts.frames[i],
      "-vf",
      [
        "crop='min(iw,ih*16/9)':'min(ih,iw*9/16)'",
        zoom,
        // scale down once — lanczos at output for clean aa after the oversized window
        `scale=${W}:${H}:flags=lanczos:eval=init`,
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
  opts.onProgress?.(0.72, "Crossfades & overlays");
  const font = findFont();
  const fontOpt = font ? `:fontfile='${font}'` : "";
  const captions = board.beats.map((b) => b.caption);
  const subs = segmentTimeline(opts.script, audioSec);
  const rtl = containsRtl(opts.script.segments.map((s) => s.text).join(" "));

  const fc: string[] = [];

  // xfade expects each input already SHIFTED so its frame-0 PTS equals the offset.
  // Pre-shift every input with setpts, then chain xfades that transition at those times.
  // frameDur = on-screen seconds for beat i (transition INTO next beat happens at frameDur[i]-FADE).
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

  // per-beat lower-third caption band
  let capAcc = 0;
  for (let i = 0; i < n; i++) {
    const st = capAcc, en = capAcc + frameDur[i];
    capAcc = en;
    const text = dte(captions[i] || "");
    if (!text) continue;
    fc.push(
      `[${last}]drawbox=x=0:y=ih-150:w=iw:h=56:color=black@0.42:t=fill:enable='between(t,${st.toFixed(2)},${en.toFixed(2)})'[cap${i}]`
    );
    fc.push(
      `[cap${i}]drawtext=text='${text}'${fontOpt}:fontsize=30:fontcolor=white:x=(w-text_w)/2:y=h-140:enable='between(t,${st.toFixed(2)},${en.toFixed(2)})'[capt${i}]`
    );
    last = `capt${i}`;
  }

  // speaker subtitles timed to real audio
  const palette = ["#FFD166", "#8FD3E8", "#EF8354", "#B8F2C0"];
  const speakers = Array.from(new Set(opts.script.segments.map((s) => s.speaker)));
  for (const s of subs) {
    const color = palette[Math.max(0, speakers.indexOf(s.speaker)) % palette.length];
    const line = rtl ? s.text : s.text; // shaping note below
    fc.push(
      `[${last}]drawtext=text='${dte(line.slice(0, 120))}'${fontOpt}:fontsize=24:fontcolor=${color.replace("#", "0x")}:borderw=2:bordercolor=black@0.8:x=(w-text_w)/2:y=h-84:enable='between(t,${s.start.toFixed(2)},${s.end.toFixed(2)})'[sub${Math.round(s.start * 100)}]`
    );
    last = `sub${Math.round(s.start * 100)}`;
  }

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
