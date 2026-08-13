import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export function GET() {
  const db = getDb();
  let prof = db.prepare("SELECT * FROM user_profile WHERE id='local'").get() as Record<string, unknown> | undefined;
  if (!prof) {
    db.prepare("INSERT INTO user_profile (id, interests, updated_at) VALUES ('local','[]',?)").run(Date.now());
    prof = db.prepare("SELECT * FROM user_profile WHERE id='local'").get() as Record<string, unknown>;
  }
  return NextResponse.json({ ...prof, interests: JSON.parse((prof.interests as string) ?? "[]") });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const db = getDb();
  db.prepare(`
    INSERT INTO user_profile (id, interests, preferred_language, preferred_voice, updated_at) VALUES ('local',?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET interests=excluded.interests, preferred_language=excluded.preferred_language, preferred_voice=excluded.preferred_voice, updated_at=excluded.updated_at
  `).run(JSON.stringify(body.interests ?? []), body.preferred_language ?? "en", body.preferred_voice ?? "af_heart", Date.now());
  return NextResponse.json({ ok: true });
}
