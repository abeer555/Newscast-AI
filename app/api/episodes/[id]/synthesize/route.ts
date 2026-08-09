import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { resumeEpisode } from "@/lib/pipeline";

export const maxDuration = 300;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const ep = db.prepare("SELECT status FROM episodes WHERE id=?").get(id) as { status: string } | undefined;
  if (!ep) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (ep.status === "synthesizing" || ep.status === "scripting" || ep.status === "evaluating") {
    return NextResponse.json({ error: "pipeline already running", status: ep.status }, { status: 409 });
  }
  void resumeEpisode(id);
  return NextResponse.json({ ok: true });
}
