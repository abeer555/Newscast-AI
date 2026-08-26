/**
 * Single source of truth for every numeric score the UI shows.
 *
 * Every metric in this file is deterministic and reproducible from stored
 * columns, so the UI can render an itemised "why this number?" breakdown whose
 * parts actually sum to the number on screen. Nothing here reads the database or
 * calls a model — pass values in, get values plus their derivation out.
 *
 * Heat is defined in the README as:
 *   heat = (12 * sources + 4 * articles) * max(0.2, 1 - age_h / window_h)
 * That formula is authoritative; this module implements it once and both the
 * clustering job and the API layer consume it.
 */

export const HEAT_WINDOW_HOURS = 48;
export const HEAT_WEIGHT_PER_SOURCE = 12;
export const HEAT_WEIGHT_PER_ARTICLE = 4;
export const HEAT_RECENCY_FLOOR = 0.2;
/** Clusters younger than this are treated as this old, so a single fresh article can't divide by ~0. */
export const MIN_AGE_HOURS = 0.5;

export type ComponentKind = "add" | "multiply";

export interface ScoreComponent {
  key: string;
  /** Short label, e.g. "Coverage breadth". */
  label: string;
  /** The arithmetic, e.g. "3 sources x 12". */
  detail: string;
  /** Points added, or the multiplier applied. */
  value: number;
  kind: ComponentKind;
  /** Human explanation of why this component exists at all. */
  note?: string;
}

export interface HeatBreakdown {
  /** Heat at `scored_at`. Always equals the components applied in order. */
  score: number;
  /** Sum of the additive components, before recency decay. */
  subtotal: number;
  components: ScoreComponent[];
  age_hours: number;
  window_hours: number;
  recency_multiplier: number;
  /** True when the story is old enough that decay hit the floor. */
  recency_floored: boolean;
  formula: string;
  /** The moment this score describes. */
  scored_at: number;
  /** What the same coverage would score right now, after further decay. */
  live_score: number;
  live_age_hours: number;
  /** True when decay since scoring has moved the number materially. */
  decayed: boolean;
}

export interface HeatInput {
  sourceCount: number;
  articleCount: number;
  /** Epoch ms of the oldest article in the cluster (clusters.first_seen). */
  firstSeen: number;
  /**
   * The moment to score for. Pass clusters.last_updated to reproduce the stored
   * trend_score exactly; omit to score as of now.
   */
  scoredAt?: number;
  now?: number;
  windowHours?: number;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function ageHoursOf(firstSeen: number, now = Date.now()): number {
  return Math.max(MIN_AGE_HOURS, (now - firstSeen) / 3_600_000);
}

export function recencyMultiplier(ageHours: number, windowHours = HEAT_WINDOW_HOURS): number {
  return Math.max(HEAT_RECENCY_FLOOR, 1 - ageHours / windowHours);
}

/**
 * Heat plus its full derivation.
 *
 * Heat is a snapshot metric: it is computed when the clustering pass runs and
 * decays afterwards. Rather than silently showing a stale number, this returns
 * the score as-of `scoredAt` (which reproduces clusters.trend_score) *and* what
 * the same coverage would score now, so the UI can say "44 when scored, 12 now"
 * instead of quietly disagreeing with itself.
 */
export function heatBreakdown(input: HeatInput): HeatBreakdown {
  const windowHours = input.windowHours ?? HEAT_WINDOW_HOURS;
  const now = input.now ?? Date.now();
  const scoredAt = input.scoredAt ?? now;
  const sources = Math.max(0, input.sourceCount);
  const articles = Math.max(0, input.articleCount);
  const ageHours = ageHoursOf(input.firstSeen, scoredAt);
  const recency = recencyMultiplier(ageHours, windowHours);

  const breadth = sources * HEAT_WEIGHT_PER_SOURCE;
  const volume = articles * HEAT_WEIGHT_PER_ARTICLE;
  const subtotal = breadth + volume;

  const components: ScoreComponent[] = [
    {
      key: "breadth",
      label: "Coverage breadth",
      detail: `${sources} ${sources === 1 ? "outlet" : "outlets"} x ${HEAT_WEIGHT_PER_SOURCE}`,
      value: breadth,
      kind: "add",
      note: "How many distinct newsrooms are carrying the story. Weighted 3x heavier than raw volume because breadth is harder to fake than repetition.",
    },
    {
      key: "volume",
      label: "Article volume",
      detail: `${articles} ${articles === 1 ? "article" : "articles"} x ${HEAT_WEIGHT_PER_ARTICLE}`,
      value: volume,
      kind: "add",
      note: "Total filings in the cluster, including follow-ups and syndicated copies.",
    },
    {
      key: "recency",
      label: "Recency decay",
      detail: `x ${round2(recency)} (${formatAgeHours(ageHours)} old when scored)`,
      value: round2(recency),
      kind: "multiply",
      note: `Linear decay across a ${windowHours}h window, floored at ${HEAT_RECENCY_FLOOR}. A story never decays to zero, but a day-old story scores about half a breaking one.`,
    },
  ];

  const score = round1(subtotal * recency);
  const liveAge = ageHoursOf(input.firstSeen, now);
  const liveScore = round1(subtotal * recencyMultiplier(liveAge, windowHours));

  return {
    score,
    subtotal,
    components,
    age_hours: round2(ageHours),
    window_hours: windowHours,
    recency_multiplier: round2(recency),
    recency_floored: recency <= HEAT_RECENCY_FLOOR + 1e-9,
    formula: `(${HEAT_WEIGHT_PER_SOURCE} x outlets + ${HEAT_WEIGHT_PER_ARTICLE} x articles) x max(${HEAT_RECENCY_FLOOR}, 1 - age/${windowHours}h)`,
    scored_at: scoredAt,
    live_score: liveScore,
    live_age_hours: round2(liveAge),
    decayed: Math.abs(liveScore - score) > Math.max(1, score * 0.1),
  };
}

/** Legacy call shape used by the clustering job. */
export function heatScore(sourceCount: number, articleCount: number, ageHours: number, windowHours = HEAT_WINDOW_HOURS): number {
  const recency = recencyMultiplier(ageHours, windowHours);
  return round1((sourceCount * HEAT_WEIGHT_PER_SOURCE + articleCount * HEAT_WEIGHT_PER_ARTICLE) * recency);
}

export interface VelocityStats {
  /** Articles per hour averaged across the cluster's whole life. */
  lifetime: number;
  /** Articles per hour over the trailing 24h, or null when unknown. */
  recent: number | null;
  articles_total: number;
  articles_24h: number | null;
  age_hours: number;
  /** "rising" | "steady" | "cooling" — recent rate vs lifetime rate. */
  trend: "rising" | "steady" | "cooling" | "unknown";
  unit: string;
  definition: string;
}

/**
 * Velocity, disambiguated. The old UI printed "0.89/h" with no unit and no
 * period, which could have meant articles, mentions or a normalised index. It is
 * articles per hour — and the lifetime average is a different number from the
 * trailing-24h rate, so both are returned and labelled.
 */
export function velocityStats(args: {
  articleCount: number;
  articles24h?: number | null;
  firstSeen: number;
  now?: number;
}): VelocityStats {
  const now = args.now ?? Date.now();
  const ageHours = ageHoursOf(args.firstSeen, now);
  const lifetime = round2(args.articleCount / ageHours);
  const has24 = typeof args.articles24h === "number";
  const recentWindow = Math.min(24, ageHours);
  const recent = has24 ? round2((args.articles24h as number) / recentWindow) : null;

  let trend: VelocityStats["trend"] = "unknown";
  if (recent !== null) {
    if (recent > lifetime * 1.25) trend = "rising";
    else if (recent < lifetime * 0.6) trend = "cooling";
    else trend = "steady";
  }

  return {
    lifetime,
    recent,
    articles_total: args.articleCount,
    articles_24h: has24 ? (args.articles24h as number) : null,
    age_hours: round2(ageHours),
    trend,
    unit: "articles/hour",
    definition:
      "New articles per hour. Lifetime is the average since the first filing in this cluster; recent is the trailing 24 hours. Counts published articles, not social mentions or page views.",
  };
}

export function formatAgeHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 24) return `${round1(h)}h`;
  const d = h / 24;
  return `${round1(d)}d`;
}

/* ------------------------------------------------------------------ *
 * Evidence strength — how well-sourced a story is, independent of how
 * loud it is. Heat measures attention; this measures corroboration.
 * ------------------------------------------------------------------ */

export type EvidenceLevel = "strong" | "moderate" | "limited" | "single";

export interface EvidenceStrength {
  level: EvidenceLevel;
  label: string;
  /** Distinct outlets carrying the story. */
  outlets: number;
  /** Distinct independent reporting chains (syndicated copies collapsed). */
  independent: number;
  /** Outlet count minus independent chains. */
  syndicated: number;
  /** Chains whose provenance we could actually verify from a byline. */
  attributed: number;
  summary: string;
  note: string;
  /** Set when the classification itself is uncertain. */
  caveat: string | null;
}

export function evidenceStrength(args: { outlets: number; independent: number; attributed?: number }): EvidenceStrength {
  const outlets = Math.max(0, args.outlets);
  const independent = Math.max(0, Math.min(args.independent, outlets));
  const syndicated = Math.max(0, outlets - independent);
  const attributed = Math.max(0, Math.min(args.attributed ?? independent, independent));
  const unstated = independent - attributed;

  let level: EvidenceLevel = "single";
  if (independent >= 3) level = "strong";
  else if (independent === 2) level = "moderate";
  else if (outlets >= 2) level = "limited";

  const label =
    level === "strong" ? "Strong" : level === "moderate" ? "Moderate" : level === "limited" ? "Limited" : "Single source";

  const chainWord = independent === 1 ? "reporting chain" : "reporting chains";
  const parts = [`${outlets} ${outlets === 1 ? "outlet" : "outlets"}`, `${independent} independent ${chainWord}`];
  if (syndicated > 0) parts.push(`${syndicated} syndicated ${syndicated === 1 ? "copy" : "copies"}`);

  const note =
    level === "strong"
      ? "Three or more newsrooms reported this independently, so it does not rest on any single account."
      : level === "moderate"
        ? "Two independent newsrooms. Corroborated, but not yet broadly confirmed."
        : level === "limited"
          ? "Several outlets are carrying it, but they trace back to one original report — extra outlets here do not add evidence."
          : "One reporting chain. Treat as a single-source account until another newsroom confirms it.";

  const caveat =
    unstated > 0
      ? `${unstated} of these ${unstated === 1 ? "outlet publishes" : "outlets publish"} no byline in the feed, so ${unstated === 1 ? "its" : "their"} copy is assumed original rather than verified as such. Independence may be overstated.`
      : null;

  return { level, label, outlets, independent, syndicated, attributed, summary: parts.join(" / "), note, caveat };
}

/* ------------------------------------------------------------------ *
 * Model-judged scores (importance, sentiment). These are not formulas —
 * they come out of an LLM — so the honest explanation is the band plus
 * the factors the model cited, never a fake calculation.
 * ------------------------------------------------------------------ */

export interface ScoreBand {
  band: string;
  meaning: string;
}

export function importanceBand(v: number): ScoreBand {
  if (v >= 80) return { band: "Critical", meaning: "Wide human or geopolitical consequence; would lead a national bulletin." };
  if (v >= 60) return { band: "High", meaning: "Significant beyond its own region or sector." };
  if (v >= 40) return { band: "Moderate", meaning: "Matters to those following the beat; limited spillover." };
  if (v >= 20) return { band: "Low", meaning: "Incremental development on an existing story." };
  return { band: "Marginal", meaning: "Routine or narrow-interest filing." };
}

export function sentimentBand(v: number): ScoreBand {
  if (v >= 70) return { band: "Positive", meaning: "Coverage frames the development as favourable." };
  if (v >= 55) return { band: "Leaning positive", meaning: "Mildly favourable framing overall." };
  if (v >= 45) return { band: "Neutral", meaning: "Descriptive coverage without clear valence." };
  if (v >= 25) return { band: "Leaning negative", meaning: "Coverage emphasises harm, loss or risk." };
  return { band: "Negative", meaning: "Coverage is dominated by harm, loss or crisis framing." };
}

export const IMPORTANCE_METHOD =
  "Editorial importance, 0-100, judged by the analysis model from the article set — scale of impact, how many people are affected, geopolitical consequence and durability. It is a model judgement, not a computed formula, so it is shown with the factors the model cited.";

export const SENTIMENT_METHOD =
  "Aggregate tone of the coverage, 0-100, where 50 is neutral. This measures how outlets are framing the event, not whether the event is good or bad, and not the analyst's opinion of it.";
