import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { runEpisodePipeline } from "@/lib/pipeline";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const db = getDb();
  
  const ep = db.prepare("SELECT * FROM episodes WHERE id=?").get(id) as { status: string } | undefined;
  if (!ep) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Update status back to analyzing so the UI switches to the loading view
  db.prepare("UPDATE episodes SET status='analyzing', progress=0, stage_label='Restarting pipeline with critique' WHERE id=?").run(id);

  // Fire and forget
  void runEpisodePipeline(id, body.critique);

  return NextResponse.json({ ok: true });
}
