import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { safeParse } from "@/lib/json";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const ep = db.prepare("SELECT * FROM episodes WHERE id=?").get(id) as Record<string, unknown> | undefined;
  if (!ep) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({
    ...ep,
    script: safeParse<unknown>(ep.script, null),
    evaluation: safeParse<unknown>(ep.evaluation, null),
    storyboard: safeParse<unknown>(ep.storyboard, null),
    visual_provenance: safeParse<unknown>(ep.visual_provenance, null),
    generation_cache: undefined,
    // The raw timeline is large and only useful via /gate, which returns
    // per-segment bounds already resolved.
    audio_timeline: undefined,
  });
}

/** PATCH: update script segments / title (user edits in the studio) */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const db = getDb();
  const ep = db.prepare("SELECT * FROM episodes WHERE id=?").get(id) as { script: string | null; status: string } | undefined;
  if (!ep) return NextResponse.json({ error: "not found" }, { status: 404 });

  const patch: Record<string, unknown> = { updated_at: Date.now() };
  if (body.title) patch.title = body.title;
  if (body.script) {
    const script = body.script;
    script.segments = script.segments.map((s: { index: number; text: string; speaker: string; voice: string; direction: string }, i: number) => ({ ...s, index: i, text: String(s.text).slice(0, 400) }));
    patch.script = JSON.stringify(script);
    if (body.invalidateAudio) {
      patch.audio_path = null;
      patch.audio_duration = null;
      patch.evaluation = null;
      // Measured timings belong to the audio that produced them; keeping them
      // across an edit would highlight the wrong sentence with total confidence.
      patch.audio_timeline = null;
      patch.status = "script_ready";
      patch.stage_label = "Script edited — needs re-synthesis";
      patch.progress = 0.42;
    }
  }
  const cols = new Set((db.prepare("PRAGMA table_info(episodes)").all() as { name: string }[]).map((r) => r.name));
  const keys = Object.keys(patch).filter((k) => cols.has(k));
  db.prepare(`UPDATE episodes SET ${keys.map((k) => `${k}=?`).join(", ")} WHERE id=?`).run(...keys.map((k) => patch[k] as string | number | null), id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  getDb().prepare("DELETE FROM episodes WHERE id=?").run(id);
  return NextResponse.json({ ok: true });
}
