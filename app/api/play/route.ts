import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function POST(req: NextRequest) {
  const { episodeId } = await req.json();
  const db = getDb();
  // A play count is telemetry. If the database is read-only the player should
  // still play, so swallow the failure rather than returning an error the
  // client would surface as "playback failed".
  try {
    db.prepare("UPDATE episodes SET play_count = play_count + 1 WHERE id=?").run(episodeId);
  } catch {
    return NextResponse.json({ ok: false, counted: false });
  }
  return NextResponse.json({ ok: true, counted: true });
}
