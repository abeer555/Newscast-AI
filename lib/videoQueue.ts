/**
 * Video render queue — spawns scripts/video-worker.ts as a detached child process so
 * long ffmpeg renders survive route timeouts, dev-server reloads and request aborts.
 * One render at a time (single local GPU + rate-limited LLM).
 */
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { getDb } from "./db";

let running = false;

export function enqueueVideoRender(episodeId: string): boolean {
  if (running) return false;
  const db = getDb();
  db.prepare("UPDATE episodes SET video_status='queued', video_error=NULL, updated_at=? WHERE id=?").run(Date.now(), episodeId);

  const worker = path.join(process.cwd(), "scripts", "video-worker.ts");
  const logDir = path.join(process.cwd(), "data", "logs");
  fs.mkdirSync(logDir, { recursive: true });
  const logFd = fs.openSync(path.join(logDir, `video-${episodeId}.log`), "a");

  const child = spawn("npx", ["tsx", worker, episodeId], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", logFd, logFd],
    detached: true,
  });
  running = true;
  child.on("exit", (code) => {
    running = false;
    fs.closeSync(logFd);
    console.log(`[video-worker] episode=${episodeId} exited code=${code}`);
  });
  child.unref();
  return true;
}
