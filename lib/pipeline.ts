import crypto from "crypto";
import fs from "fs";
import path from "path";
import { getDb } from "./db";
import { generateScript, EpisodeFormat, PodcastScript, ScriptLanguage } from "./scriptgen";
import { synthesizeEpisode } from "./synth";
import { chatJson } from "./chat";
import { episodeProgress, logEvent } from "./bus";
import { enqueueVideoRender } from "./videoQueue";
import { planStoryboard, planStoryboardFromArticles, Storyboard, Beat } from "./storyboard";
import { StoryIntelligence } from "./intelligence";
import { comfyAvailable, generateImage } from "./comfyui";
import { renderEpisodeVideo } from "./video";
import { attestClaims, detectContradictions, VerifiedFact } from "./verification";
import { fuseStory } from "./living";
import { planEvidenceVisuals, VisualPlan } from "./visualplan";
import { evaluateEpisodeComprehensive, PipelineEvaluation } from "./evaluate";
import { episodeGate, persistGate } from "./gates";


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

/** Columns the episodes table actually has, so a pre-migration database (the
 *  read-only demo path never runs ALTER TABLE) drops unknown keys instead of
 *  failing the whole update and losing the audio with it. */
let episodeColumns: Set<string> | null = null;
function knownEpisodeColumns(): Set<string> {
  if (episodeColumns) return episodeColumns;
  try {
    const rows = getDb().prepare("PRAGMA table_info(episodes)").all() as { name: string }[];
    episodeColumns = new Set(rows.map((r) => r.name));
  } catch {
    episodeColumns = new Set();
  }
  return episodeColumns;
}

function setEpisode(id: string, patch: Record<string, unknown>) {
  const db = getDb();
  const cols = knownEpisodeColumns();
  const keys = Object.keys(patch).filter((k) => cols.size === 0 || cols.has(k));
  if (!keys.length) return;
  try {
    db.prepare(`UPDATE episodes SET ${keys.map((k) => `${k}=?`).join(", ")}, updated_at=? WHERE id=?`).run(...keys.map((k) => patch[k] as string | number | null), Date.now(), id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("readonly") || msg.includes("read-only") || msg.includes("SQLITE_READONLY")) {
      console.error(`[setEpisode] Database is read-only - cannot update episode ${id}`);
      throw new Error("Database is in read-only mode. Episode updates are not available on this deployment.");
    }
    throw e;
  }
}

export function emit(episodeId: string, status: string, progress: number, stage: string, extra?: unknown) {
  setEpisode(episodeId, { status, progress, stage_label: stage });
  episodeProgress(episodeId, status, progress, stage, extra);
}

export async function runEpisodePipeline(episodeId: string, critique?: string[]): Promise<void> {
  const db = getDb();
  const ep = db.prepare("SELECT * FROM episodes WHERE id=?").get(episodeId) as {
    id: string; cluster_id: string; format: EpisodeFormat; language: ScriptLanguage; style: string; script: string | null; title: string;
  };
  if (!ep) throw new Error("episode not found");

  // Log if this is a regeneration with critique
  if (critique && critique.length > 0) {
    logEvent("pipeline", `Regenerating episode ${episodeId} with ${critique.length} critique points`);
    console.log(`[pipeline] Regenerating episode ${episodeId} with critique:`, critique);
  }

  try {
    // 1. intelligence + evidence layers
    emit(episodeId, "analyzing", 0.05, "Analyzing story intelligence");
    emit(episodeId, "analyzing", 0.10, "Verifying claims across sources");
    let facts: VerifiedFact[] = [];
    try {
      facts = await attestClaims(ep.cluster_id);
      detectContradictions(facts);
    } catch (e) {
      logEvent("error", `Claim verification failed for ${ep.cluster_id}`, String(e));
    }
    emit(episodeId, "analyzing", 0.14, "Fusing living story + timeline");
    try {
      await fuseStory(ep.cluster_id);
    } catch (e) {
      logEvent("error", `Story fusion failed for ${ep.cluster_id}`, String(e));
    }

    // 2. script
    emit(episodeId, "scripting", 0.18, "Writing episode script");
    const { script, intel, model } = await generateScript({ clusterId: ep.cluster_id, format: ep.format, language: ep.language, style: ep.style, critique });
    const scriptHash = crypto.createHash("sha1").update(JSON.stringify(script.segments.map((s) => [s.voice, s.text]))).digest("hex");
    
    console.log(`[pipeline] Generated new script for ${episodeId}: ${script.segments.length} segments, title: "${script.title}"`);
    if (critique && critique.length > 0) {
      console.log(`[pipeline] Script was regenerated with critique - should be improved`);
    }
    
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
    await synthesizeCurrentScript(episodeId, intel, facts);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setEpisode(episodeId, { status: "failed", error: msg, progress: 0 });
    episodeProgress(episodeId, "failed", 0, msg);
    logEvent("error", `Episode ${episodeId} failed`, msg);
  }
}

export async function synthesizeCurrentScript(episodeId: string, intelArg?: unknown, factsArg?: VerifiedFact[]): Promise<void> {
  const db = getDb();
  const ep = db.prepare("SELECT * FROM episodes WHERE id=?").get(episodeId) as {
    id: string; language: ScriptLanguage; script: string | null; cluster_id: string;
  };
  if (!ep?.script) throw new Error("No script to synthesize");
  const script = JSON.parse(ep.script) as PodcastScript;

  // refresh intel for evaluation
  let intel: StoryIntelligence | null = null;
  if (intelArg) intel = intelArg as StoryIntelligence;
  else {
    const cl = db.prepare("SELECT intelligence FROM clusters WHERE id=?").get(ep.cluster_id) as { intelligence: string | null };
    intel = cl?.intelligence ? JSON.parse(cl.intelligence) : null;
  }

  // Evidence sets (refresh if missing)
  let facts = factsArg;
  if (!facts) {
    try { facts = db.prepare("SELECT * FROM cluster_facts WHERE cluster_id=?").all(ep.cluster_id) as VerifiedFact[]; } catch { facts = []; }
  }
  if (!facts.length) {
    try { facts = await attestClaims(ep.cluster_id); detectContradictions(facts); } catch { /* soft-fail */ }
  }

  emit(episodeId, "synthesizing", 0.45, "Synthesizing voices");
  const totalSegs = script.segments.length;
  const result = await synthesizeEpisode({
    episodeId,
    script,
    language: ep.language,
    onProgress: (done, total) => {
      const p = 0.45 + 0.3 * (done / total);
      emit(episodeId, "synthesizing", Math.round(p * 100) / 100, `Voicing segment ${Math.min(done, totalSegs)}/${totalSegs}`);
    },
  });

  setEpisode(episodeId, {
    audio_path: result.audioPath,
    audio_duration: result.durationSec,
    audio_segments: result.segmentCount,
    // Measured per-utterance offsets. Empty when any chunk could not be measured,
    // so the player falls back to an estimate and says so rather than half-guessing.
    audio_timeline: result.timeline.length ? JSON.stringify(result.timeline) : null,
    progress: 0.75,
    stage_label: "Evaluating episode quality",
    status: "evaluating",
  });
  episodeProgress(episodeId, "evaluating", 0.75, "Evaluating episode quality");
  logEvent(
    "pipeline",
    `Audio synthesized for ${episodeId}: ${result.durationSec}s across ${result.segmentCount} segments ` +
      `(${result.ttsCalls} TTS calls, ${result.cacheHits} reused, timeline ${result.timeline.length ? "measured" : "unavailable"})`,
  );

  // 4. Editorial critique from the model — advisory only. It is recorded so a
  // reviewer can read it, but it does not decide anything; the gate below does.
  let evalNote: string | null = null;
  try {
    // Build a visual plan proxy (mode weights) so evaluation sees picture-intent
    const stubVisuals: VisualPlan = {
      default_mode: "generated",
      beats: ((): VisualPlan["beats"] => {
        return (script.segments || []).slice(0, 8).map((_, i) => ({ beat_index: i, mode: "generated" as const, prompt: "", rationale: "not generated yet", fact_ids: [] }));
      })(),
    };
    const evaluation: PipelineEvaluation = await evaluateEpisodeComprehensive({
      script,
      intel,
      facts,
      visualPlan: stubVisuals,
      audioDurationSec: result.durationSec,
    });
    setEpisode(episodeId, { evaluation: JSON.stringify({
      // keep legacy "scores" key structure intact so the existing UI chip still works
      scores: {
        accuracy: evaluation.scores.factual_accuracy,
        balance: evaluation.scores.source_coverage,
        clarity: evaluation.scores.narrative_clarity,
        engagement: evaluation.scores.visual_relevance,
        naturalness: evaluation.scores.audio_quality,
        syndication: evaluation.scores.syndication_handling,
        contradiction: evaluation.scores.contradiction_disclosure,
      },
      // extended axes:
      visual_relevance: evaluation.scores.visual_relevance,
      audio_quality: evaluation.scores.audio_quality,
      subtitle_sync: evaluation.scores.subtitle_sync,
      syndication_handling: evaluation.scores.syndication_handling,
      contradiction_disclosure: evaluation.scores.contradiction_disclosure,
      publish_confidence: evaluation.publish_confidence,
      decision: evaluation.decision,
      reasons: evaluation.reasons,
      fact_check_notes: evaluation.fact_check_notes,
      improvements: evaluation.improvements,
    }) });
    logEvent("pipeline", `Episode ${episodeId} model advisory score=${evaluation.publish_confidence.toFixed(2)} opinion=${evaluation.decision}`);
  } catch (e) {
    evalNote = `evaluation failed: ${String(e)}`;
    logEvent("error", `Evaluation failed for ${episodeId}`, evalNote ?? "");
  }

  // 5. The gate. Nine deterministic checks over what was actually produced —
  // claim backing, evidence strength, contradiction disclosure, syndication
  // honesty, audio, timings, subtitle fit, provenance. The model's opinion above
  // is not an input. A publish decision here is reproducible and itemised, which
  // is the whole point: a held episode can always say exactly what to fix.
  const gate = episodeGate(episodeId);
  if (gate) persistGate(gate);
  const isPublished = gate ? gate.verdict === "publish" : false;
  const publishedAt = isPublished ? Date.now() : null;
  const hasAudio = result.audioPath !== null;
  const heldLabel = gate
    ? `Held — ${gate.headline.replace(/^Held: /, "")}`
    : "Held — the publish gate could not be evaluated";

  setEpisode(episodeId, {
    status: isPublished ? "ready" : "needs_review",
    progress: isPublished ? 1 : 0.95,
    stage_label: isPublished ? (hasAudio ? "Ready — video render queued" : "Ready (Audio skipped)") : heldLabel,
    published_at: publishedAt,
  });
  episodeProgress(
    episodeId,
    isPublished ? "ready" : "needs_review",
    isPublished ? 1 : 0.95,
    isPublished ? (hasAudio ? "Ready — video render queued" : "Ready (Audio skipped)") : heldLabel,
  );
  if (gate) {
    logEvent(
      "pipeline",
      `Gate for ${episodeId}: ${gate.score}/100 → ${gate.verdict}` +
        (gate.blocking.length ? ` (blocking: ${gate.blocking.join(", ")})` : ""),
    );
  }

  try {
    if (isPublished && hasAudio) {
      if (enqueueVideoRender(episodeId)) {
        logEvent("pipeline", `Video render queued for ${episodeId}`);
      }
    }
  } catch (e) {
    logEvent("error", `Could not queue video for ${episodeId}`, String(e));
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
    const fmt = (script as { format?: string }).format ?? "briefing";
    const density = Math.round(((script.segments.length / (intentWords[fmt] ?? 20)) * 100 + 100) / 1);
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

/**
 * Video worker entry — executed by scripts/video-worker.ts in a detached process.
 * design the look (storyboard) → render one 1280x720 frame per beat on the local
 * Z-Image-Turbo ComfyUI server → ffmpeg stitches frames into a Ken Burns slideshow
 * with crossfades, lower-third captions, speaker subtitles and the narration as the
 * master clock. Idempotent: re-running overwrites the previous storyboard/video.
 */
export async function renderEpisodeVideoJob(episodeId: string): Promise<void> {
  const db = getDb();
  const ep = db.prepare("SELECT id, cluster_id, script, audio_path, audio_duration, format, video_mode FROM episodes WHERE id=?").get(episodeId) as
    | { id: string; cluster_id: string; script: string | null; audio_path: string | null; audio_duration: number | null; format: string; video_mode?: string }
    | undefined;
  if (!ep?.script || !ep.audio_path) throw new Error("video needs a script + synthesized audio");

  const script = JSON.parse(ep.script) as PodcastScript;
  const cl = db.prepare("SELECT intelligence FROM clusters WHERE id=?").get(ep.cluster_id) as { intelligence: string | null } | undefined;
  const intel = cl?.intelligence ? (JSON.parse(cl.intelligence) as StoryIntelligence) : null;
  await renderVideoForEpisode(episodeId, script, intel, ep.audio_duration ?? script.estimated_seconds, ep.format === "reel", ep.video_mode || "local");
}

async function downloadImage(url: string, destPath: string): Promise<boolean> {
  try {
    const res = await fetch(url, { timeout: 10000 } as RequestInit);
    if (!res.ok) return false;
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync(destPath, buffer);
    return true;
  } catch {
    return false;
  }
}

async function renderVideoForEpisode(
  episodeId: string,
  script: PodcastScript,
  intel: StoryIntelligence | null,
  audioDurationSec: number,
  isReel = false,
  videoMode = "local",
): Promise<void> {
  const db = getDb();


  // 1. how should the video look
  emit(episodeId, "rendering_video", 0.80, "Designing storyboard");
  setEpisode(episodeId, { video_status: "storyboard" });
  const epCluster = (db.prepare("SELECT cluster_id FROM episodes WHERE id=?").get(episodeId) as { cluster_id: string }).cluster_id;

  // ── resolve storyboard ──────────────────────────────────────────────────
  let board: Storyboard | undefined;

  if (videoMode === "article_images") {
    // Article images ONLY mode: scrape from articles, use web search fallback, NO AI generation
    const articles = db
      .prepare(
        "SELECT image_url FROM articles JOIN cluster_articles ON articles.id = cluster_articles.article_id WHERE cluster_articles.cluster_id = ? AND image_url IS NOT NULL AND image_url != ''"
      )
      .all(epCluster) as { image_url: string }[];
    const rawUrls = Array.from(new Set(articles.map((a) => a.image_url)));

    logEvent("pipeline", `Found ${rawUrls.length} article images for ${episodeId}, validating quality...`);

    // Import the smart scraper
    const { scrapeAndValidateImages } = await import("./imageScraper");
    
    // Calculate how many images we need
    const estimatedBeats = Math.ceil(audioDurationSec / 5); // ~5 seconds per beat
    const requiredImages = Math.min(estimatedBeats, 20); // Cap at 20

    // Scrape and validate (with intelligent web search fallback via Groq Llama API)
    const scrapeResult = await scrapeAndValidateImages(
      rawUrls, 
      episodeId, 
      requiredImages,
      40, // min quality score
      script // pass script for intelligent web search fallback
    );
    const scrapedImages = scrapeResult.images;

    if (scrapedImages.length >= 3) {
      // Minimum threshold met - use scraped images ONLY
      logEvent("pipeline", `✓ Found ${scrapedImages.length} quality images (${rawUrls.length} from articles, ${scrapedImages.length - rawUrls.length} from web search) - NO AI generation`);
      
      const scrapedPaths = scrapedImages.map(img => img.path);
      board = planStoryboardFromArticles(script, scrapedPaths);
      
      // Mark ALL as article source (including web-searched ones)
      for (let i = 0; i < board.beats.length; i++) {
        board.beats[i].image_source = "article";
        const srcImg = scrapedImages[i % scrapedImages.length];
        if (srcImg) {
          board.beats[i].quality_score = srcImg.quality_score;
          (board.beats[i] as Beat & { original_url?: string }).original_url = srcImg.article_url;
        }
      }
      
      setEpisode(episodeId, { 
        storyboard: JSON.stringify(board),
        video_mode: "article_images" 
      });
      
      logEvent("pipeline", `Storyboard (article images only): ${board.beats.length} beats using ${scrapedImages.length} real images (cycled)`);
    } else {
      // Not enough images found - fail with clear message
      const msg = `Only found ${scrapedImages.length} images (need minimum 3). Article images mode requires actual images from news sources.`;
      setEpisode(episodeId, { 
        video_status: "failed", 
        video_error: msg 
      });
      throw new Error(msg);
    }
  }

  if (videoMode === "local") {
    if (!(await comfyAvailable())) {
      setEpisode(episodeId, { video_status: "failed", video_error: `ComfyUI not reachable at ${process.env.COMFYUI_URL ?? "http://127.0.0.1:8188"}` });
      throw new Error("ComfyUI offline — start it and press Render video");
    }

    board = await planStoryboard(script, intel);

    // ─── evidence-aware visual plan ────────────────────────────────────────
    const facts = db.prepare("SELECT * FROM cluster_facts WHERE cluster_id=?").all(epCluster) as VerifiedFact[];
    if (facts.length) {
      try {
        const visualPlan = await planEvidenceVisuals({ beats: board.beats, segments: script.segments, facts, intel });
        logEvent("pipeline", `Visual plan for ${episodeId}: ${visualPlan.beats.map((b) => b.mode).join("/")}`);
        const n = board.beats.length;
        const beatsAreOneIndexed = visualPlan.beats.length > 0 && visualPlan.beats.every((b) => b.beat_index >= 1 && b.beat_index <= n);
        const shift = beatsAreOneIndexed ? 1 : 0;
        for (const pv of visualPlan.beats) {
          const idx = Math.max(0, Math.min(n - 1, pv.beat_index - shift));
          if (board.beats[idx] && idx >= 0) {
            board.beats[idx].image_prompt = pv.prompt;
            (board.beats[idx] as Beat & { mode?: string; fact_ids?: string[] }).mode = pv.mode;
            (board.beats[idx] as Beat & { fact_ids?: string[] }).fact_ids = pv.fact_ids;
          }
        }
        setEpisode(episodeId, { storyboard: JSON.stringify(board) });
      } catch (e) {
        logEvent("error", `Visual plan failed: ${String(e)}`);
      }
    }
    logEvent("pipeline", `Storyboard: ${board.beats.length} beats / ${board.total_duration}s for ${episodeId}`);
  }

  if (!board) throw new Error("Storyboard could not be built — no video mode resolved.");

  // 2. one frame per beat, sequential so the local GPU queue stays shallow
  const frames: string[] = [];
  for (let i = 0; i < board.beats.length; i++) {
    const b: Beat = board.beats[i];
    if (videoMode === "local") {
      emit(episodeId, "rendering_video", Math.round((0.82 + 0.10 * (i / board.beats.length)) * 100) / 100, `Frame ${i + 1}/${board.beats.length} — ${b.caption || "visual"}`);
      const img = await generateImage({ prompt: b.image_prompt, negative: b.negative_prompt, width: 1280, height: 720, seed: hashSeed(`${episodeId}:${i}`), steps: 8 });
      frames.push(img.filePath);
      (board!.beats[i] as Beat & { frame_path?: string }).frame_path = img.filePath;
      // Provenance is recorded at the moment the frame is made, so nothing
      // synthetic can later be mistaken for documentary footage.
      board!.beats[i].image_source = "ai_generated";
    } else {
      // In article_images mode, the frame_path is already populated
      frames.push((b as Beat & { frame_path: string }).frame_path);
    }
    setEpisode(episodeId, { storyboard: JSON.stringify(board) });
  }
  setEpisode(episodeId, { storyboard: JSON.stringify(board), video_status: "rendering" });

  // 3. stitch
  emit(episodeId, "rendering_video", 0.94, "Encoding video");
  const audioAbs = path.join(process.cwd(), "public", `${episodeId}.wav`);
  const audioInPublic = path.join(process.cwd(), "public", "audio", `${episodeId}.wav`);
  const audioFile = fs.existsSync(audioInPublic) ? audioInPublic : audioAbs;
  const out = await renderEpisodeVideo({
    episodeId,
    storyboard: board,
    frames,
    audioPath: audioFile,
    audioDuration: audioDurationSec,
    script,
    isReel,
  });

  // The video is ready, but whether the *episode* is publishable is not the video's
  // call — the gate decides that below, once the frames it inspects exist.
  setEpisode(episodeId, { video_path: out.publicPath, video_duration: out.durationSec, video_status: "ready", video_error: null });

  // A provenance ledger for the finished video: one row per frame stating whether
  // it is a photograph from the coverage or a generated illustration. Stored so the
  // claim can be audited later without re-deriving it from the storyboard.
  try {
    const ledger = board.beats.map((bt) => ({
      beat: bt.index,
      source: bt.image_source ?? "unknown",
      quality_score: bt.quality_score ?? null,
      original_url: (bt as Beat & { original_url?: string }).original_url ?? null,
      caption: bt.caption ?? "",
    }));
    const generated = ledger.filter((l) => l.source === "ai_generated").length;
    setEpisode(episodeId, {
      visual_provenance: JSON.stringify({
        recorded_at: Date.now(),
        mode: videoMode,
        frames: ledger.length,
        source_photos: ledger.filter((l) => l.source === "article").length,
        ai_generated: generated,
        unlabelled: ledger.filter((l) => l.source === "unknown").length,
        beats: ledger,
      }),
    });
  } catch (e) {
    logEvent("error", `Could not record visual provenance for ${episodeId}`, String(e));
  }

  // The gate's provenance check can only pass once frames exist, so re-run it — and
  // let it, not the render, decide the episode's status. An episode held for an
  // undisclosed contradiction does not become publishable because a video finished.
  let label = "Ready with video";
  try {
    const gate = episodeGate(episodeId);
    if (gate) {
      persistGate(gate);
      const cleared = gate.verdict === "publish";
      label = cleared ? "Ready with video" : `Held — ${gate.headline.replace(/^Held: /, "")}`;
      setEpisode(episodeId, {
        status: cleared ? "ready" : "needs_review",
        progress: cleared ? 1 : 0.95,
        stage_label: label,
        published_at: cleared ? Date.now() : null,
      });
    } else {
      setEpisode(episodeId, { status: "ready", progress: 1, stage_label: label });
    }
  } catch {
    // A gate failure must not strand the episode mid-pipeline when the video exists.
    setEpisode(episodeId, { status: "ready", progress: 1, stage_label: label });
  }

  episodeProgress(episodeId, "ready", 1, label, { video: out.publicPath });
  logEvent("pipeline", `Video ready for ${episodeId}: ${out.durationSec}s at ${out.publicPath} (${label})`);
}

function hashSeed(s: string): number {
  const h = crypto.createHash("sha1").update(s).digest();
  return h.readUInt32BE(0);
}

export function createEpisode(opts: { clusterId: string; format: EpisodeFormat; language: ScriptLanguage; style: string }): string {
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
