/**
 * Self-evaluating pipeline — the model-as-editor-in-chief scorecard.
 * Replaces the old single-axis "evaluate" call with a structured report covering:
 * factual accuracy, source coverage, narrative clarity, visual relevance, audio quality, subtitle sync,
 * syndication handling, contradiction disclosure, and the final publish decision (0..1 confidence).
 */
import { chatJson, LLM_MODELS } from "./chat";
import { PodcastScript } from "./scriptgen";
import { StoryIntelligence } from "./intelligence";
import { VerifiedFact } from "./verification";
import { VisualPlan } from "./visualplan";

export interface PipelineEvaluation {
  scores: {
    factual_accuracy: number;        // claims in script map to verified facts
    source_coverage: number;         // story quotes diverse canonical origins, not just one wire
    narrative_clarity: number;       // hook → body → resolution readable by ear
    visual_relevance: number;        // each beat's visual maps to its caption
    audio_quality: number;           // script speakable (paces, lengths, no awkward punct)
    subtitle_sync: number;           // segment text length fits expected on-screen time
    syndication_handling: number;    // doesn't claim 5-source consensus when 5 copies of one wire report
    contradiction_disclosure: number; // explicit flag for disputed claims
  };
  publish_confidence: number;        // weighted 0..1 → gate threshold lives elsewhere
  decision: "publish" | "needs_review";
  reasons: string[];                  // human-readable gate decisions
  fact_check_notes: string;           // biggest open question if any
  improvements: string[];
}

const GATE = { publish_threshold: 0.72 };

export async function evaluateEpisodeComprehensive(args: {
  script: PodcastScript;
  intel: StoryIntelligence | null;
  facts: VerifiedFact[];
  visualPlan: VisualPlan | null;
  audioDurationSec: number;
}): Promise<PipelineEvaluation> {
  const scriptText = args.script.segments.map((s) => `${s.speaker}: ${s.text}`).join("\n");
  const factsTxt = args.facts
    .map((f) => {
      const sources = JSON.parse(f.attestation_json) as { source: string; original: boolean }[];
      const orig = sources.filter((s) => s.original).map((s) => s.source);
      const tags = orig.length ? `originals:[${orig.slice(0, 3).join(",")}]` : `copies:[${sources.slice(0, 3).map((s) => s.source).join(",")}]`;
      return `[${f.id}] ${f.status} conf=${f.confidence.toFixed(2)} ${tags} — ${f.claim}`;
    })
    .join("\n");

  const panels = args.visualPlan
    ? args.visualPlan.beats.map((b) => `[beat ${b.beat_index}] mode=${b.mode} facts=${b.fact_ids.length}`).join("\n")
    : "(no visual plan)";

  const { data } = await chatJson<Omit<PipelineEvaluation, "scores"> & { scores: PipelineEvaluation["scores"] }>({
    model: LLM_MODELS.frontier,
    system:
      `You are the editor-in-chief of NEWSCAST AI. Score every axis 0-100 and decide publish (>= ${GATE.publish_threshold * 100}) or needs_review (< ${GATE.publish_threshold * 100}).

- factual_accuracy: every sentence in the script must trace to a verified fact in the list. 100 = every claim traceable to a 'confirmed' fact with 3+ canonical origins; 60 = mostly traceable; 30 = invented/untraceable.
- source_coverage: 100 = story cites facts from at least 3 canonical origins and at least 2 sources overall; penalize if everything hangs on one syndicated report.
- narrative_clarity: 100 = hook within first 2 segments, then logical progression.
- visual_relevance: 100 = every beat's prompt directly describes the caption/segment content.
- audio_quality: 100 = all segments between 8-25 words, no run-ons, natural spoken cadence.
- subtitle_sync: 100 = 12-20 words per 4-6s beat, consistent rhythm.
- syndication_handling: 100 = when 5 articles share one original wire report, the script says "a Reuters report, picked up by…" not "5 outlets confirm"; 50 = ambiguous; 0 = false confirmation.
- contradiction_disclosure: 100 = every pair of facts with contradicted_by is acknowledged in-script ("By contrast X reports Y").

Also:
- publish_confidence: weighted 0..1 (accuracy 30, coverage 20, contradiction 15, syndication 10, clarity 10, visuals 8, audio 5, sync 2).
- reasons: 2-6 short human-readable bullets explaining the biggest drivers of the score.
- fact_check_notes: what biggest fact is thin or contested and what would firm it up.
- improvements: 3-5 SPECIFIC, ACTIONABLE edits (each ≤40 words). Format as direct imperatives: "Add source attribution to segment 3", "Break segment 7 into two shorter sentences", "Replace vague 'sources say' in segment 5 with actual source names from the dossier". Be concrete and reference specific segment numbers or text.
`,
    user: `SCRIPT (title=${args.script.title}, est ${args.script.estimated_seconds}s, real ${args.audioDurationSec}s, ${args.script.segments.length} segments):
${scriptText}

VERIFIED FACTS (${args.facts.length}):
${factsTxt || "(no facts — verification layer offline)"}

VISUAL PLAN:
${panels}

STORY INTELLIGENCE (summary):
${args.intel?.summary_long ?? args.intel?.lede ?? "(no dossier)"}

Return JSON with keys: scores{ factual_accuracy, source_coverage, narrative_clarity, visual_relevance, audio_quality, subtitle_sync, syndication_handling, contradiction_disclosure }, publish_confidence (0..1), decision ("publish"|"needs_review"), reasons[], fact_check_notes, improvements[].`,
    jsonObject: true,
    maxTokens: 4500,
    temperature: 0.25,
    task: "evaluation",
  });

  // Clamp and sanitize
  const scores = Object.fromEntries(Object.entries(data.scores).map(([k, v]) => [k, Math.max(0, Math.min(100, Number(v) || 0))])) as PipelineEvaluation["scores"];
  const publish_confidence = Math.max(0, Math.min(1, Number(data.publish_confidence)));
  const decision = publish_confidence >= GATE.publish_threshold ? "publish" : "needs_review";
  return {
    scores,
    publish_confidence,
    decision,
    reasons: Array.isArray(data.reasons) ? data.reasons : [`score=${publish_confidence.toFixed(2)}`],
    fact_check_notes: data.fact_check_notes ?? "",
    improvements: Array.isArray(data.improvements) ? data.improvements.slice(0, 3) : [],
  };
}
