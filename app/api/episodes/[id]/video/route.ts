import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { enqueueVideoRender } from "@/lib/videoQueue";

export const maxDuration = 60;

interface EpisodeRow {
  id: string;
  status: string;
  video_status: string | null;
  script: string | null;
  audio_path: string | null;
}

/** POST — queue a video render for an episode that already has audio. Returns immediately. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const ep = db.prepare("SELECT id,status,video_status,script,audio_path FROM episodes WHERE id=?").get(id) as EpisodeRow | undefined;
  if (!ep) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!ep.script || !ep.audio_path) {
    return NextResponse.json({ error: "episode needs synthesized audio before video" }, { status: 400 });
  }
  if (ep.video_status === "queued" || ep.video_status === "storyboard" || ep.video_status === "rendering") {
    return NextResponse.json({ error: "video already in progress", video_status: ep.video_status }, { status: 409 });
  }
  const body = await _req.json().catch(() => ({}));
  const videoMode = body.video_mode === "article_images" ? "article_images" : "local";
  db.prepare("UPDATE episodes SET video_mode=? WHERE id=?").run(videoMode, id);

  const ok = enqueueVideoRender(id);
  if (!ok) return NextResponse.json({ error: "render queue busy" }, { status: 409 });
  return NextResponse.json({ ok: true, video_status: "queued" });
}

/** GET — video status + path for polling UIs. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ep = getDb()
    .prepare("SELECT video_status, video_path, video_duration, video_error, storyboard FROM episodes WHERE id=?")
    .get(id) as { video_status: string | null; video_path: string | null; video_duration: number | null; video_error: string | null; storyboard: string | null } | undefined;
  if (!ep) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({
    video_status: ep.video_status ?? "pending",
    video_path: ep.video_path,
    video_duration: ep.video_duration,
    video_error: ep.video_error,
    beat_count: ep.storyboard ? (JSON.parse(ep.storyboard) as { beats?: unknown[] }).beats?.length ?? 0 : 0,
  });
}
