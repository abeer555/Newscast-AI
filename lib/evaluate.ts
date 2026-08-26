/**
 * The model's editorial critique of a finished episode.
 *
 * This is deliberately *advisory*. It used to be the publish gate, which meant a
 * model scored its own work and then let itself out of the door — unauditable, not
 * reproducible, and with an obvious interest in liking the result. The gate now lives
 * in lib/gates.ts as fixed arithmetic over stored evidence, and this report is kept
 * for the things arithmetic cannot see: a clumsy transition, a buried lede, an
 * attribution that reads as stronger than it is. It is stored and shown labelled as
 * one reader's opinion, and it cannot publish or hold an episode.
 */
import { chatJson, LLM_MODELS } from "./chat";
import { PodcastScript } from "./scriptgen";
import { StoryIntelligence } from "./intelligence";
import { Attestation, VerifiedFact } from "./verification";
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
  publish_confidence: number;        // weighted 0..1 — advisory, the gate decides publication
  decision: "publish" | "needs_review";
  reasons: string[];                  // human-readable drivers of the opinion
  fact_check_notes: string;           // biggest open question if any
  improvements: string[];
}

/** The confidence at which the model would call an episode publishable. Advisory —
 *  the binding threshold is PUBLISH_THRESHOLD in lib/gates.ts. */
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
      // Outlet count alone is misleading: five outlets carrying one wire dispatch is
      // one piece of reporting. Each attestation names the independent chain it
      // belongs to and whether that outlet reported first-hand or carried someone
      // else's copy, so the critique can judge whether the script's attribution is honest.
      let att: Attestation[] = [];
      try {
        const parsed = JSON.parse(f.attestation_json);
        if (Array.isArray(parsed)) att = parsed as Attestation[];
      } catch {
        att = [];
      }
      const firstHand = att.filter((a) => ["original", "wire_origin", "mixed"].includes(a.originality)).map((a) => a.source);
      const carried = att.filter((a) => ["syndicated", "unattributed"].includes(a.originality)).map((a) => a.source);
      const chains = [...new Set(att.map((a) => a.chain_label).filter(Boolean))];
      const tags = [
        firstHand.length ? `first-hand:[${firstHand.slice(0, 3).join(", ")}]` : null,
        carried.length ? `carrying-it:[${carried.slice(0, 3).join(", ")}]` : null,
        chains.length ? `chains:[${chains.slice(0, 3).join(" | ")}]` : null,
        f.contradicted_by ? "CONTRADICTED" : null,
      ]
        .filter(Boolean)
        .join(" ");
      return `[${f.id}] ${f.tier ?? f.status} — ${f.outlet_count} outlet(s) / ${f.independent_count} independent chain(s), conf=${f.confidence.toFixed(2)} ${tags} — ${f.claim}`;
    })
    .join("\n");

  const panels = args.visualPlan
    ? args.visualPlan.beats.map((b) => `[beat ${b.beat_index}] mode=${b.mode} facts=${b.fact_ids.length}`).join("\n")
    : "(no visual plan)";

  const { data } = await chatJson<Omit<PipelineEvaluation, "scores"> & { scores: PipelineEvaluation["scores"] }>({
    model: LLM_MODELS.frontier,
    system:
      `You are a senior editor reviewing a finished NEWSCAST AI episode. Score every axis 0-100. Your verdict is advisory: a separate deterministic gate decides whether this publishes, so be candid rather than diplomatic.

- factual_accuracy: every sentence in the script must trace to a fact in the list. 100 = every assertion traces to a 'confirmed' or 'corroborated' fact; 60 = mostly traceable; 30 = assertions with no matching fact.
- source_coverage: 100 = the episode rests on facts carried by at least 2 independent reporting chains. Judge chains, not outlet counts — everything hanging on a single chain is thin no matter how many outlets republished it.
- narrative_clarity: 100 = hook within first 2 segments, then logical progression.
- visual_relevance: 100 = every beat's prompt directly describes the caption/segment content.
- audio_quality: 100 = all segments between 8-25 words, no run-ons, natural spoken cadence.
- subtitle_sync: 100 = 12-20 words per 4-6s beat, consistent rhythm.
- syndication_handling: 100 = when four outlets share one wire dispatch, the script says "a Reuters report, picked up by…" rather than "four outlets confirm"; 50 = ambiguous; 0 = it claims confirmation that does not exist.
- contradiction_disclosure: 100 = every fact marked CONTRADICTED is acknowledged in-script ("By contrast X reports Y"); 0 = a contradicted claim is narrated as settled.

Also:
- publish_confidence: weighted 0..1 (accuracy 30, coverage 20, contradiction 15, syndication 10, clarity 10, visuals 8, audio 5, sync 2).
- reasons: 2-6 short human-readable bullets explaining the biggest drivers of the score.
- fact_check_notes: which claim is thinnest or most contested, and what would firm it up.
- improvements: 3-5 SPECIFIC, ACTIONABLE edits (each ≤40 words). Direct imperatives naming the segment: "Attribute the casualty figure in segment 3 to AP by name", "Break segment 7 into two sentences", "Replace 'sources say' in segment 5 with the outlets from the dossier".
`,
    user: `SCRIPT (title=${args.script.title}, est ${args.script.estimated_seconds}s, real ${args.audioDurationSec}s, ${args.script.segments.length} segments):
${scriptText}

VERIFIED FACTS (${args.facts.length}) — format: [id] tier — outlets / independent chains, confidence, provenance:
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
    improvements: Array.isArray(data.improvements) ? data.improvements.slice(0, 5) : [],
  };
}
