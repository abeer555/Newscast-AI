/**
 * Evidence-aware visual planner — decides for each storyboard beat whether the visual should be
 *   - GENERATED (default, Z-Image)
 *   - MAP (cartographic reveal — zoomed city/region)
 *   - DATA (chart/infographic)
 *   - SOURCED (rich real newspaper/document visual style)
 *   - ARCHIVAL (vintage file-photo mood)
 * and synthesizes the prompt so the visual nature matches the evidence shape of the beat.
 */
import { StoryIntelligence } from "./intelligence";
import { VerifiedFact } from "./verification";
import { chatJson, LLM_MODELS } from "./chat";

export type VisualMode = "generated" | "map" | "data" | "sourced" | "archival";

export interface PlannedBeatVisual {
  beat_index: number;
  mode: VisualMode;
  /** rewritten image prompt optimized for the chosen mode (map topographic lines, data bar chart, etc.) */
  prompt: string;
  rationale: string;
  /** which fact ids this beat visualizes (for accountability) */
  fact_ids: string[];
}

export interface VisualPlan {
  beats: PlannedBeatVisual[];
  default_mode: VisualMode;
}

const MODE_HINTS: Record<VisualMode, string> = {
  generated: "editorial illustration, painterly texture, muted palette, ABSOLUTELY NO text or letters anywhere",
  map: "top-down cartographic illustration, terrain, borders — visually encoded only with color and line, ABSOLUTELY NO letters, street names, or labels",
  data: "abstract infographic as physical objects — bars as concrete slabs, trends as winding roads — ABSOLUTELY NO digits, letters, or axis labels",
  sourced: "close-up of a physical document or artifact (redaction bars, seals, folded paper) — ABSOLUTELY NO readable words, names, or logos on it",
  archival: "film-grain archival photograph, slight sepia or desaturated teal, 1970s-1990s press-photography feel — ABSOLUTELY NO text overlays",
};

/**
 * Decide visual mode per beat given the narration, topic, and which verified facts
 * land on it. No external images fetched — every mode renders through Z-Image with
 * a specific style hint; "map" / "data" / "sourced" / "archival" just shape the prompt.
 */
export async function planEvidenceVisuals(args: {
  beats: { index: number; caption: string; image_prompt: string; segment_range: [number, number] }[];
  segments: { index: number; text: string }[];
  facts: VerifiedFact[];
  intel: StoryIntelligence | null;
}): Promise<VisualPlan> {
  const mapFacts = args.facts.map((f) => ({ id: f.id, claim: f.claim, status: f.status, confidence: f.confidence, sources: JSON.parse(f.attestation_json) as { source: string }[] }));

  const { data } = await chatJson<{
    beats: { beat_index: number; mode: VisualMode; prompt: string; rationale: string; fact_ids: string[] }[];
    default_mode: VisualMode;
  }>({
    model: LLM_MODELS.frontier,
    system:
      `You are the visual director of NEWSCAST AI working with the chief fact-checker.
For each narration beat, decide what KIND of visual best serves the audience AND most truthfully represents the underlying evidence:

- GENERATED: default editorial illustration, scenes, portraits.
- MAP: use when the beat is about geography (borders, corridors, fronts, regions, distances). Top-down carto.
- DATA: use when the beat cites numbers, trends, tolls, comparisons. Abstract infographic without readable numbers.
- SOURCED: use when the beat depends on specific documents, named reports, files, official records. Close-up of the artifact.
- ARCHIVAL: use when the beat refers to history (months/years ago) and no verified fresh imagery exists.

Attach fact_ids: which claims from the verified set this beat illustrates (look at claim text vs beat caption). Empty if none.

Rewrite each beat's image_prompt so the style matches the chosen mode. Mode-specific style guides:
- generated: ${MODE_HINTS.generated}
- map: ${MODE_HINTS.map}
- data: ${MODE_HINTS.data}
- sourced: close-up of physical evidence: official-looking document with visible redaction bars and seals, newspaper front page on a desk, passport stamps — but NEVER readable text or real names (image models cannot render legible words)
- archival: ${MODE_HINTS.archival}

CRITICAL: the image generator cannot render text. Every prompt must say "no text, no letters, no words, no typography" and all visuals must be symbolic: maps, buildings, people, scenery, abstract shapes, documents-as-objects. NEVER ask for a specific headline, sign, nameplate, or written word.

Output JSON: {"beats":[{"beat_index":0,"mode":"generated","prompt":"...","rationale":"...","fact_ids":["id1"]}], "default_mode":"generated"}
The beat_index values must be exactly 0..N-1 (NOT 1-based) in the same order as the input list. Do not reorder or skip.`,
    user: `STORY: ${args.intel?.headline ?? ""}

BEATS WITH CAPTIONS:
${args.beats.map((b, i) => `[Beat ${b.index}] caption="${b.caption}" prompt="${b.image_prompt}"  segments=${b.segment_range}`).join("\n")}

SCRIPT SEGMENTS REFERENCED:
${args.segments.map((s) => `[Seg ${s.index}] ${s.text}`).join("\n")}

VERIFIED FACTS (claim-level):
${mapFacts.map((f) => `[${f.id}] (${f.status}, ${f.confidence.toFixed(2)}, ${f.sources.length} sources) ${f.claim}`).join("\n")}`,
    jsonObject: true,
    maxTokens: 6000,
    temperature: 0.4,
    task: "visual_plan",
  });

  return {
    beats: data.beats.map((b) => ({ ...b, beat_index: b.beat_index })),
    default_mode: data.default_mode ?? "generated",
  };
}
