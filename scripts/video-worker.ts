/**
 * Standalone video render worker — spawned by lib/videoQueue.enqueueVideoRender()
 * so image-gen + ffmpeg can take minutes without holding open a Next.js request.
 * Usage: npx tsx scripts/video-worker.ts <episodeId>
 */
import fs from "fs";
import path from "path";

// Load .env manually (Next.js does this for the server, but we're a detached process)
for (const name of [".env.local", ".env"]) {
  const p = path.join(process.cwd(), name);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
}

import { renderEpisodeVideoJob } from "../lib/pipeline";
import { getDb } from "../lib/db";

const episodeId = process.argv[2];

async function main() {
  if (!episodeId) {
    console.error("usage: tsx scripts/video-worker.ts <episodeId>");
    process.exit(2);
  }
  console.log(`[video-worker] start episode=${episodeId}`);
  try {
    await renderEpisodeVideoJob(episodeId);
    console.log(`[video-worker] done episode=${episodeId}`);
    process.exit(0);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[video-worker] failed episode=${episodeId}:`, msg);
    try {
      getDb().prepare("UPDATE episodes SET video_status='failed', video_error=?, updated_at=? WHERE id=? AND COALESCE(video_status,'') NOT IN ('ready')")
        .run(msg, Date.now(), episodeId);
    } catch { /* best effort */ }
    process.exit(1);
  }
}

void main();
