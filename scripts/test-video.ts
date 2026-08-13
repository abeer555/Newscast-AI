/**
 * End-to-end video smoke test — bypasses LLM calls (fixed storyboard) but exercises
 * the whole production path: ComfyUI frame gen → Ken Burns clips → xfade concat →
 * drawtext overlays → audio sync → MP4. Run: npx tsx scripts/test-video.ts
 */
import fs from "fs";
import path from "path";
async function loadEnv() {
  for (const name of [".env.local", ".env"]) {
    const p = path.join(process.cwd(), name);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  }
}
await loadEnv();

const { comfyAvailable, generateImage } = await import("../lib/comfyui");
const { renderEpisodeVideo } = await import("../lib/video");
const { segmentTimeline } = await import("../lib/storyboard");
const { concatWavs } = await import("../lib/synth");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const script = {
  title: "Smoke Test: A Quiet Morning Over the City",
  description: "Five-beat visual test of the NEWSCAST AI video pipeline.",
  tags: ["test", "visual"],
  hosts: [
    { name: "Heart", role: "host", voice: "af_heart" },
    { name: "Adam", role: "analyst", voice: "am_adam" },
  ],
  segments: [
    { index: 0, speaker: "Heart", voice: "af_heart", direction: "", text: "Dawn light washes over the skyline as the city slowly wakes." },
    { index: 1, speaker: "Adam", voice: "am_adam", direction: "thoughtful", text: "It's the first time we've seen this kind of atmospheric anomaly on record." },
    { index: 2, speaker: "Heart", voice: "af_heart", direction: "", text: "Markets fill with bread and flowers while trains sing underground." },
    { index: 3, speaker: "Adam", voice: "am_adam", direction: "urgent", text: "Look closely at the data — the pressure drop is almost vertical here." },
    { index: 4, speaker: "Heart", voice: "af_heart", direction: "", text: "And by dusk the whole grid hums — a city dreaming in amber." },
  ],
  estimated_seconds: 26,
};

const storyboard = {
  style: "cinematic editorial news illustration, muted teal-and-amber palette",
  aspect: "16:9" as const,
  total_duration: 26,
  beats: [
    { index: 0, image_prompt: "wide aerial of a sleeping city skyline at first light, soft mist, teal roofs and amber windows waking, cinematic editorial news illustration, muted teal-and-amber palette, volumetric light, subtle painterly texture, 16:9 composition, no text, no watermarks", negative_prompt: "text, words, logos, watermark, low quality, blurry, gore, nsfw", caption: "The city wakes", duration: 5, segment_range: [0, 0] as [number, number] },
    { index: 1, image_prompt: "ferries crossing a calm harbor at golden hour, long white wakes behind them, distant cranes, cinematic editorial news illustration, muted teal-and-amber palette, volumetric light, subtle painterly texture, 16:9 composition, no text, no watermarks", negative_prompt: "text, words, logos, watermark, low quality, blurry, gore, nsfw", caption: "Harbors reopen", duration: 5, segment_range: [1, 1] as [number, number] },
    { index: 2, image_prompt: "close-up of a market stall stacked with bread loaves and flower buckets, steadicam feel, warm interior light spilling onto cobblestones, cinematic editorial news illustration, muted teal-and-amber palette, volumetric light, 16:9 composition, no text, no watermarks", negative_prompt: "text, words, logos, watermark, low quality, blurry, gore, nsfw", caption: "Markets fill", duration: 5, segment_range: [2, 2] as [number, number] },
    { index: 3, image_prompt: "modern skyscrapers at noon with delivery drones tracing light trails between them, slight low-angle, cinematic editorial news illustration, muted teal-and-amber palette, volumetric light, subtle painterly texture, 16:9 composition, no text, no watermarks", negative_prompt: "text, words, logos, watermark, low quality, blurry, gore, nsfw", caption: "Towers at noon", duration: 5, segment_range: [3, 3] as [number, number] },
    { index: 4, image_prompt: "city grid at dusk seen from high above, streetlights forming amber constellations against deep teal blocks, last light on rooftops, cinematic editorial news illustration, muted teal-and-amber palette, volumetric light, 16:9 composition, no text, no watermarks", negative_prompt: "text, words, logos, watermark, low quality, blurry, gore, nsfw", caption: "Grid in amber", duration: 5, segment_range: [4, 4] as [number, number] },
  ],
};

async function main() {
  if (!(await comfyAvailable())) {
    console.error("ComfyUI is not reachable on 127.0.0.1:8188 — start it first.");
    process.exit(1);
  }
  console.log("· ComfyUI online");

  // 1. frames
  const frames: string[] = [];
  for (const b of storyboard.beats) {
    const t = Date.now();
    const img = await generateImage({ prompt: b.image_prompt, negative: b.negative_prompt, width: 1280, height: 720, seed: 123 + b.index, steps: 8 });
    console.log(`✓ beat ${b.index} frame ${path.basename(img.filePath)} (${Date.now() - t}ms)`);
    frames.push(img.filePath);
  }

  // 2. a 26s synthetic narration bed (sine-pulse "voice" just to hold duration)
  const wavDur = 26.2;
  const sr = 22050;
  const n = Math.floor(wavDur * sr);
  const pcm = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const envelope = 0.35 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 0.7 * t)) + 0.2; // slow pulse
    const s = Math.sin(2 * Math.PI * (150 + 40 * Math.sin(2 * Math.PI * 0.45 * t)) * t) * envelope;
    pcm.writeInt16LE(Math.max(-1, Math.min(1, s)) * 32767, i * 2);
  }
  const wav = Buffer.alloc(44 + pcm.length);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + pcm.length, 4); wav.write("WAVE", 8);
  wav.write("fmt ", 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sr, 24); wav.writeUInt32LE(sr * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(pcm.length, 40); pcm.copy(wav, 44);
  const audioPath = path.join(process.cwd(), "public", "audio", "smoke-test.wav");
  fs.mkdirSync(path.dirname(audioPath), { recursive: true });
  fs.writeFileSync(audioPath, wav);
  console.log(`✓ narration bed ${wavDur}s → ${audioPath}`);

  // 3. render
  const t = Date.now();
  const out = await renderEpisodeVideo({
    episodeId: "smoke-test",
    storyboard,
    frames,
    audioPath,
    audioDuration: wavDur,
    script,
    onProgress: (p, label) => console.log(`  [render ${(p * 100) | 0}%] ${label}`),
  });
  console.log(`✓ video rendered in ${((Date.now() - t) / 1000).toFixed(1)}s → ${out.publicPath} (${out.durationSec}s)`);
  console.log(`  open ${out.filePath}`);
}
void main();
