import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { chatJson } from "@/lib/chat";
import { episodeGate, episodeMedia, persistGate } from "@/lib/gates";
import type { PodcastScript } from "@/lib/scriptgen";

/**
 * Rewrite one line of a script, grounded in the story's verified claims.
 *
 * The point of doing this per line rather than regenerating the episode is that a
 * review finding is almost always local: one sentence overstates the sourcing, one
 * line runs too long for a subtitle, one claim needs attributing by name. Throwing
 * away a whole voiced episode to fix a sentence wastes the audio and, worse, invites
 * new errors in the parts that were already correct.
 *
 * The rewrite sees only the claims the evidence layer actually holds, along with
 * their tier, and is told in the prompt not to assert anything beyond them. Audio is
 * invalidated afterwards because a line that changed has not been voiced — but the
 * TTS cache means re-voicing calls the engine only for the utterances that moved.
 */

interface Rewrite {
  text: string;
  rationale: string;
}

const SYSTEM = `You are a news editor rewriting a single line of a broadcast script.
Rules you must not break:
- Assert only what the supplied claims support. If a claim rests on one outlet, attribute it ("according to <outlet>") rather than stating it as established fact.
- Never invent a number, name, date, place or quote that is not in the claims.
- Match the surrounding tone and the speaker's voice. One or two sentences.
- Stay under 40 spoken words so the line works as a subtitle.
- If the instruction asks for something the claims cannot support, write the closest line that IS supported and say so in the rationale.
Return JSON: {"text": "...", "rationale": "one sentence on what you changed and why"}`;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { index?: number; instruction?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body with a segment index." }, { status: 400 });
  }

  const index = Number(body.index);
  if (!Number.isInteger(index) || index < 0) {
    return NextResponse.json({ error: "A valid segment index is required." }, { status: 400 });
  }

  const db = getDb();
  const ep = db.prepare("SELECT id, cluster_id, script, status FROM episodes WHERE id=?").get(id) as
    | { id: string; cluster_id: string; script: string | null; status: string }
    | undefined;
  if (!ep?.script) return NextResponse.json({ error: "This episode has no script to edit." }, { status: 404 });

  let script: PodcastScript;
  try {
    script = JSON.parse(ep.script) as PodcastScript;
  } catch {
    return NextResponse.json({ error: "The stored script could not be read." }, { status: 500 });
  }

  const seg = script.segments?.[index];
  if (!seg) return NextResponse.json({ error: `There is no line ${index + 1} in this script.` }, { status: 400 });

  // Ground the rewrite in what the evidence layer holds, with tiers attached so the
  // model can see which claims are safe to assert and which need attributing.
  const media = episodeMedia(id);
  const claims = (media?.claims ?? []).slice(0, 40);
  const relevant = claims.filter((c) => c.segments.includes(index));
  const pool = (relevant.length ? relevant : claims).slice(0, 18);

  const claimBlock = pool.length
    ? pool
        .map((c) => `- [${c.tier}, ${c.independent_count} independent chain(s), outlets: ${c.outlets.join(", ") || "unknown"}] ${c.claim}`)
        .join("\n")
    : "(The evidence layer holds no claims for this story. Do not add any new factual assertion — only rephrase what is already in the line.)";

  const before = script.segments[Math.max(0, index - 1)]?.text ?? "";
  const after = script.segments[index + 1]?.text ?? "";

  const user = `STORY CLAIMS AVAILABLE TO YOU:
${claimBlock}

PREVIOUS LINE: ${before || "(none — this opens the episode)"}
LINE TO REWRITE (speaker ${seg.speaker}): ${seg.text}
NEXT LINE: ${after || "(none — this closes the episode)"}

EDITOR'S INSTRUCTION: ${body.instruction?.trim() || "Tighten this line and make its sourcing honest — attribute anything that rests on a single outlet, and cut it to subtitle length."}`;

  let rewrite: Rewrite;
  try {
    const res = await chatJson<Rewrite>({
      system: SYSTEM,
      user,
      temperature: 0.4,
      maxTokens: 400,
      jsonObject: true,
      task: "segment_rewrite",
    });
    rewrite = res.data;
  } catch (e) {
    return NextResponse.json({ error: `Rewrite failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }

  const text = String(rewrite?.text ?? "").trim();
  if (!text) return NextResponse.json({ error: "The rewrite came back empty; the line is unchanged." }, { status: 502 });

  const previous = seg.text;
  script.segments[index] = { ...seg, text: text.slice(0, 400) };

  try {
    const cols = new Set((db.prepare("PRAGMA table_info(episodes)").all() as { name: string }[]).map((r) => r.name));
    const patch: Record<string, unknown> = {
      script: JSON.stringify(script),
      // The line is not voiced yet, so the existing audio no longer matches the
      // script. Re-synthesis is cheap: the TTS cache reuses every unchanged utterance.
      audio_path: null,
      audio_duration: null,
      audio_timeline: null,
      status: "script_ready",
      stage_label: `Line ${index + 1} rewritten — needs re-synthesis`,
      progress: 0.42,
      updated_at: Date.now(),
    };
    const keys = Object.keys(patch).filter((k) => cols.has(k));
    db.prepare(`UPDATE episodes SET ${keys.map((k) => `${k}=?`).join(", ")} WHERE id=?`).run(
      ...keys.map((k) => patch[k] as string | number | null),
      id,
    );
  } catch (e) {
    return NextResponse.json({ error: `Could not save the rewrite: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
  }

  const gate = episodeGate(id);
  if (gate) persistGate(gate);

  return NextResponse.json({
    ok: true,
    index,
    previous,
    text: script.segments[index].text,
    rationale: String(rewrite?.rationale ?? "").trim(),
    claims_used: pool.map((c) => ({ id: c.id, tier: c.tier })),
    gate,
  });
}
