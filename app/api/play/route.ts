import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function POST(req: NextRequest) {
  const { episodeId } = await req.json();
  const db = getDb();
  db.prepare("UPDATE episodes SET play_count = play_count + 1 WHERE id=?").run(episodeId);
  return NextResponse.json({ ok: true });
}
