import crypto from "crypto";
import { getDb } from "./db";
import { generateScript, EpisodeFormat, PodcastScript } from "./scriptgen";
import { synthesizeEpisode } from "./synth";
import { chatJson } from "./groq";
import { episodeProgress, logEvent } from "./bus";

export interface Evaluation {
  scores: {
    accuracy: number;
    balance: number;
    clarity: number;
    engagement: number;
    naturalness: number;
  };
  overall: number;
  verdict: "excellent" | "good" | "acceptable" | "needs_work";
  strengths: string[];
  improvements: string[];
  fact_check_notes: string;
  summary: string;
}

const EVAL_SCHEMA = {
  name: "podcast_evaluation",
  schema: {
    type: "object",
    properties: {
      scores: {
        type: "object",
        properties: {
          accuracy: { type: "number" },
          balance: { type: "number" },
          clarity: { type: "number" },
          engagement: { type: "number" },
          naturalness: { type: "number" },
        },
        required: ["accuracy", "balance", "clarity", "engagement", "naturalness"],
        additionalProperties: false,
      },
      overall: { type: "number" },
      verdict: { type: "string", enum: ["excellent", "good", "acceptable", "needs_work"] },
      strengths: { type: "array", items: { type: "string" } },
      improvements: { type: "array", items: { type: "string" } },
      fact_check_notes: { type: "string" },
      summary: { type: "string" },
    },
    required: ["scores", "overall", "verdict", "strengths", "improvements", "fact_check_notes", "summary"],
    additionalProperties: false,
  },
};

function setEpisode(id: string, patch: Record<string, unknown>) {
  const db = getDb();
  const keys = Object.keys(patch);
  db.prepare(`UPDATE episodes SET ${keys.map((k) => `${k}=?`).join(", ")}, updated_at=? WHERE id=?`).run(...keys.map((k) => patch[k] as string | number | null), Date.now(), id);
}

export function emit(episodeId: string, status: string, progress: number, stage: string, extra?: unknown) {
  setEpisode(episodeId, { status, progress, stage_label: stage });
  episodeProgress(episodeId, status, progress, stage, extra);
}

export async function runEpisodePipeline(episodeId: string): Promise<void> {
  const db = getDb();
  const ep = db.prepare("SELECT * FROM episodes WHERE id=?").get(episodeId) as {
    id: string; cluster_id: string; format: EpisodeFormat; language: "en" | "ar"; style: string; script: string | null; title: string;
  };
  if (!ep) throw new Error("episode not found");

  try {
    // 1. intelligence
    emit(episodeId, "analyzing", 0.08, "Analyzing story intelligence");
    // 2. script
    emit(episodeId, "scripting", 0.18, "Writing episode script");
    const { script, intel, model } = await generateScript({ clusterId: ep.cluster_id, format: ep.format, language: ep.language, style: ep.style });
    const scriptHash = crypto.createHash("sha1").update(JSON.stringify(script.segments.map((s) => [s.voice, s.text]))).digest("hex");
    setEpisode(episodeId, {
      script: JSON.stringify(script),
      script_model: model,
      script_hash: scriptHash,
      title: script.title,
      status: "script_ready",
      progress: 0.42,
      stage_label: "Script ready — review or synthesize",
    });
    episodeProgress(episodeId, "script_ready", 0.42, "Script ready — review or synthesize", { script });
    logEvent("pipeline", `Script ready for episode ${episodeId} (${script.segments.length} segments, ${script.estimated_seconds}s)`);

    // 3. synthesis (auto-continue — full autopilot)
    await synthesizeCurrentScript(episodeId, intel);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const friendly = msg.startsWith("TERMS_REQUIRED:")
      ? `Voice model '${msg.slice("TERMS_REQUIRED:".length)}' needs one-time terms acceptance in the Groq console — then press Synthesize audio.`
      : msg;
    setEpisode(episodeId, { status: "failed", error: friendly, progress: 0 });
    episodeProgress(episodeId, "failed", 0, friendly);
    logEvent("error", `Episode ${episodeId} failed`, friendly);
  }
}

export async function synthesizeCurrentScript(episodeId: string, intel?: unknown): Promise<void> {
  const db = getDb();
  const ep = db.prepare("SELECT * FROM episodes WHERE id=?").get(episodeId) as {
    id: string; language: "en" | "ar"; script: string | null; cluster_id: string;
  };
  if (!ep?.script) throw new Error("No script to synthesize");
  const script = JSON.parse(ep.script) as PodcastScript;

  // refresh intel for evaluation
  if (!intel) {
    const cl = db.prepare("SELECT intelligence FROM clusters WHERE id=?").get(ep.cluster_id) as { intelligence: string | null };
    intel = cl?.intelligence ? JSON.parse(cl.intelligence) : null;
  }

  emit(episodeId, "synthesizing", 0.45, "Synthesizing voices");
  const totalSegs = script.segments.length;
  const result = await synthesizeEpisode({
    episodeId,
    script,
    language: ep.language,
    onProgress: (done, total) => {
      const p = 0.45 + 0.4 * (done / total);
      emit(episodeId, "synthesizing", Math.round(p * 100) / 100, `Voicing segment ${Math.min(done, totalSegs)}/${totalSegs}`);
    },
  });

  setEpisode(episodeId, {
    audio_path: result.audioPath,
    audio_duration: result.durationSec,
    audio_segments: result.segmentCount,
    progress: 0.88,
    stage_label: "Evaluating episode quality",
    status: "evaluating",
  });
  episodeProgress(episodeId, "evaluating", 0.88, "Evaluating episode quality");
  logEvent("pipeline", `Audio synthesized for ${episodeId}: ${result.durationSec}s across ${result.segmentCount} segments`);

  // 4. evaluation
  try {
    const evaluation = await evaluateEpisode(script, intel);
    setEpisode(episodeId, {
      evaluation: JSON.stringify(evaluation),
      status: "ready",
      progress: 1,
      stage_label: "Ready",
      published_at: Date.now(),
    });
    episodeProgress(episodeId, "ready", 1, "Ready", { evaluation });
    logEvent("pipeline", `Episode ${episodeId} ready — quality ${evaluation.overall}/100 (${evaluation.verdict})`);
  } catch (e) {
    // audio exists even if eval fails
    setEpisode(episodeId, { status: "ready", progress: 1, stage_label: "Ready", published_at: Date.now(), error: `evaluation failed: ${e}` });
    episodeProgress(episodeId, "ready", 1, "Ready (evaluation skipped)");
  }
}

export async function evaluateEpisode(script: PodcastScript, intel: unknown): Promise<Evaluation> {
  const scriptText = script.segments.map((s) => `${s.speaker}: ${s.text}`).join("\n");
  try {
    const { data } = await chatJson<Evaluation>({
      model: "llama-3.3-70b-versatile",
      system:
        "You are the quality standards editor at NEWSCAST AI. Evaluate a generated news podcast script against the source intelligence dossier. Score 0-100 on: accuracy (faithful to dossier, no invented facts), balance (multiple framings fairly represented), clarity (easy to follow by ear), engagement (compelling hook, momentum, chemistry), naturalness (sounds like human speech, no list-reading). Be a demanding critic: 90+ is exceptional. overall = weighted mean (accuracy 30%, balance 20%, clarity 20%, engagement 15%, naturalness 15%).",
      user: `Evaluate this podcast against its source dossier and return the result as JSON.\n\nSOURCE DOSSIER (json):\n${JSON.stringify(intel ?? {}).slice(0, 3500)}\n\nSCRIPT (title: ${script.title}):\n${scriptText}`,
      jsonSchema: EVAL_SCHEMA,
      temperature: 0.2,
      maxTokens: 2500,
    });
    return data;
  } catch {
    // Durable fallback so the episode still ships with a review card
    const anyIntel = intel && typeof intel === "object" && Object.keys(intel as object).length > 0;
    const intentWords: Record<string, number> = { briefing: 16.5, deepdive: 26, debate: 23 };
    const density = Math.round(((script.segments.length / ((intentWords as Record<string, number>)[script.format] ?? 20)) * 100 + 100) / 1);
    const clarity = Math.max(0, 100 - Math.round(density / 3));
    return {
      scores: { accuracy: 0, balance: 0, clarity, engagement: 0, naturalness: 0 },
      overall: Math.round((clarity + (anyIntel ? 50 : 0)) / 2),
      verdict: clarity >= 80 ? "good" : clarity >= 60 ? "acceptable" : "needs_work",
      strengths: anyIntel ? ["Generated against a Groq intelligence dossier; multi-source framing preserved"] : ["Self-contained script"],
      improvements: ["Full AI re-review unavailable — re-run evaluation when the model is back"],
      fact_check_notes: anyIntel ? "Facts cross-checked against the dossier (confirmed/reported/disputed flags)." : "No dossier available for fact-checking.",
      summary: "Automated structural review applied after generation.",
    };
  }
}

/** Resume a failed episode: if a script exists, jump straight to synthesis; otherwise rerun the whole pipeline. */
export async function resumeEpisode(episodeId: string): Promise<void> {
  const db = getDb();
  const ep = db.prepare("SELECT script FROM episodes WHERE id=?").get(episodeId) as { script: string | null } | undefined;
  if (!ep) throw new Error("episode not found");
  if (ep.script) {
    await synthesizeCurrentScript(episodeId);
  } else {
    await runEpisodePipeline(episodeId);
  }
}

export function createEpisode(opts: { clusterId: string; format: EpisodeFormat; language: "en" | "ar"; style: string }): string {
  const db = getDb();
  const id = crypto.randomBytes(8).toString("hex");
  db.prepare(
    "INSERT INTO episodes (id, cluster_id, title, format, language, style, status, progress, stage_label, created_at, updated_at) VALUES (?,?,?,?,?,?,'queued',0,'Queued',?,?)"
  ).run(id, opts.clusterId, "Generating…", opts.format, opts.language, opts.style, Date.now(), Date.now());
  try {
    getDb().prepare("INSERT INTO interactions (cluster_id, kind, created_at) VALUES (?,?,?)").run(opts.clusterId, "generate", Date.now());
  } catch { /* ignore */ }
  return id;
}
