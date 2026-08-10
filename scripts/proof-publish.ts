/**
 * Runs the full evidence+publish path on an episode that already has audio:
 * claims (if missing) → living story (if missing) → 8-axis evaluation → publish gate row.
 * Idempotent, safe to re-run. Usage: npx tsx scripts/proof-publish.ts <episodeId>
 */
import fs from "fs"; import path from "path";
for (const name of [".env.local", ".env"]) {
  const p = path.join(process.cwd(), name);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
}

const episodeId = process.argv[2] ?? "bd8bc5d60e01f616";

const { getDb } = await import("../lib/db");
const { attestClaims, detectContradictions } = await import("../lib/verification");
const { fuseStory } = await import("../lib/living");
const { planEvidenceVisuals } = await import("../lib/visualplan");
const { evaluateEpisodeComprehensive } = await import("../lib/evaluate");

const db = getDb();
const ep = db.prepare("SELECT id, cluster_id, title, script, audio_duration, storyboard FROM episodes WHERE id=?").get(episodeId) as Record<string, unknown>;
if (!ep) throw new Error("episode not found");

const script = JSON.parse(ep.script as string);
const cluster = db.prepare("SELECT intelligence FROM clusters WHERE id=?").get(ep.cluster_id as string) as { intelligence: string | null };
const intel = cluster?.intelligence ? JSON.parse(cluster.intelligence) : null;
console.log(`· ${ep.title as string}`);

// 1. evidence (cheap if already done — claims already in DB)
let facts = db.prepare("SELECT * FROM cluster_facts WHERE cluster_id=?").all(ep.cluster_id as string) as import("../lib/verification").VerifiedFact[];
if (!facts.length) {
  console.log("→ attest claims");
  facts = await attestClaims(ep.cluster_id as string);
}
console.log(`· ${facts.length} verified claims in place`);
const contradictions = detectContradictions(facts);
console.log(`· ${contradictions.length} contradiction pairs flagged`);

// 2. living story
let living = db.prepare("SELECT version FROM living_story WHERE cluster_id=?").get(ep.cluster_id as string);
if (!living) {
  console.log("→ fuse living story");
  living = await fuseStory(ep.cluster_id as string);
}
console.log(`· living story v${(living as { version: number } | null)?.version ?? "-"}`);

// 3. plan evidence-aware visuals using existing storyboard if any
const board = ep.storyboard ? JSON.parse(ep.storyboard as string) : { beats: [] };
console.log(`→ evidence-aware visual planning across ${board.beats.length} beats …`);
const visualPlan = await planEvidenceVisuals({
  beats: board.beats,
  segments: script.segments,
  facts,
  intel,
});
console.log("✓ visual plan:", visualPlan.beats.map(b => `${b.beat_index}:${b.mode}`).join(" "));

// 4. comprehensive evaluation + publish gate
console.log("→ 8-axis evaluation …");
const evaluation = await evaluateEpisodeComprehensive({
  script,
  intel,
  facts,
  visualPlan,
  audioDurationSec: ep.audio_duration as number,
});
console.log("── scores");
Object.entries(evaluation.scores).forEach(([k, v]) => console.log(`   ${k.padEnd(28)} ${v}`));
console.log(`── publish_confidence: ${evaluation.publish_confidence.toFixed(3)} → ${evaluation.decision}`);
evaluation.reasons.forEach((r, i) => console.log(`   ${i + 1}. ${r}`));

// Persist — gate row AND surface in episode so the UI shows the verdict
db.prepare("INSERT OR REPLACE INTO publish_gates (episode_id, score, verdict, reasons, decided_at) VALUES (?,?,?,?,?)")
  .run(episodeId, evaluation.publish_confidence, evaluation.decision, JSON.stringify(evaluation.reasons), Date.now());
db.prepare("UPDATE episodes SET evaluation=?, status=?, stage_label=?, progress=?, updated_at=? WHERE id=?")
  .run(JSON.stringify({
    scores: {
      accuracy: evaluation.scores.factual_accuracy,
      balance: evaluation.scores.source_coverage,
      clarity: evaluation.scores.narrative_clarity,
      engagement: evaluation.scores.visual_relevance,
      naturalness: evaluation.scores.audio_quality,
    },
    publish_confidence: evaluation.publish_confidence,
    decision: evaluation.decision,
    reasons: evaluation.reasons,
    fact_check_notes: evaluation.fact_check_notes,
    improvements: evaluation.improvements,
    syndication_handling: evaluation.scores.syndication_handling,
    contradiction_disclosure: evaluation.scores.contradiction_disclosure,
    subtitle_sync: evaluation.scores.subtitle_sync,
    visual_relevance: evaluation.scores.visual_relevance,
    audio_quality: evaluation.scores.audio_quality,
  }), evaluation.decision === "publish" ? "ready" : "needs_review",
     evaluation.decision === "publish" ? "Ready (gated publish)" : `Needs review — ${Math.round(evaluation.publish_confidence * 100)}%`,
     1, Date.now(), episodeId);
console.log(`✓ publish_gates row + episode.evaluation written (${evaluation.decision})`);
const stored = db.prepare("SELECT score, verdict FROM publish_gates WHERE episode_id=?").get(episodeId) as { score: number; verdict: string };
console.log(`✓ readback: ${stored.score.toFixed(3)} ${stored.verdict}`);
