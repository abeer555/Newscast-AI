import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const ep = db.prepare("SELECT * FROM episodes WHERE id=?").get(id) as Record<string, unknown> | undefined;
  if (!ep) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({
    ...ep,
    script: ep.script ? JSON.parse(ep.script as string) : null,
    evaluation: ep.evaluation ? JSON.parse(ep.evaluation as string) : null,
    generation_cache: undefined,
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
      patch.status = "script_ready";
      patch.stage_label = "Script edited — needs re-synthesis";
      patch.progress = 0.42;
    }
  }
  const keys = Object.keys(patch);
  db.prepare(`UPDATE episodes SET ${keys.map((k) => `${k}=?`).join(", ")} WHERE id=?`).run(...keys.map((k) => patch[k] as string | number | null), id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  getDb().prepare("DELETE FROM episodes WHERE id=?").run(id);
  return NextResponse.json({ ok: true });
}
