import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { episodeGate, episodeMedia, persistGate, recordOverride } from "@/lib/gates";

/**
 * The publish gate and the media chain for one episode.
 *
 * GET returns both: the itemised checks that decide whether the episode may be
 * published, and the claim → sentence → timestamp → beat links the studio needs to
 * make playback evidence-backed. They are served together because they are derived
 * from the same pass over the script and the story's claims, and recomputing them
 * separately would let the two disagree.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = episodeGate(id);
  if (!gate) return NextResponse.json({ error: "not found" }, { status: 404 });
  const media = episodeMedia(id);
  persistGate(gate);
  return NextResponse.json({ gate, media });
}

/**
 * POST recomputes the gate, publishes an episode that cleared it, or records a
 * human decision to publish over one it held.
 *
 * An override is deliberately not silent: it is stored with the reason given and
 * surfaced on the episode afterwards, so "someone approved this anyway" remains
 * part of the record rather than washing out into a green badge.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { approve?: boolean; note?: string } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const gate = episodeGate(id);
  if (!gate) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (!body.approve) {
    persistGate(gate);
    return NextResponse.json({ gate, media: episodeMedia(id) });
  }

  const note = (body.note ?? "").trim();
  const passing = gate.verdict === "publish";

  // Publishing an episode the gate already cleared is not an override and does not
  // need a justification. Publishing one it held does, and the reason is stored.
  if (!passing && !note) {
    return NextResponse.json(
      { error: "This episode did not clear the gate. An override needs a reason — it is stored with the episode." },
      { status: 400 },
    );
  }

  if (passing) persistGate(gate);
  else recordOverride(id, note, gate.score);

  try {
    getDb()
      .prepare("UPDATE episodes SET status=?, progress=1, stage_label=?, published_at=?, updated_at=? WHERE id=?")
      .run(
        "ready",
        passing
          ? `Published — cleared the gate at ${gate.score}/100`
          : gate.blocking.length
            ? `Published by override — ${gate.blocking.length} check(s) still failing`
            : `Published by override — score ${gate.score}/100`,
        Date.now(),
        Date.now(),
        id,
      );
  } catch (e) {
    return NextResponse.json({ error: `Could not publish: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
  }

  const after = episodeGate(id);
  return NextResponse.json({ gate: after ?? gate, media: episodeMedia(id), overridden: !passing });
}
