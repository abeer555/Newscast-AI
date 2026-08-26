/**
 * The global news picture, in one line.
 *
 * The dashboard used to open with four vanity counters — total articles, total
 * clusters, total episodes, total minutes of audio — none of which tell a reader
 * anything about the news. This module computes the editorial state of the desk
 * instead: how many stories are moving, how many are corroborated, how many are
 * contested, and how many rest on a single account.
 *
 * Every figure here is a count over stored columns with the rule stated next to
 * it, so a number on screen can always be checked against the rule that produced
 * it. Nothing in this file calls a model.
 */

import { getDb } from "./db";
import { HEAT_WINDOW_HOURS } from "./scoring";

export type PulseKey = "developing" | "breaking" | "corroborated" | "contested" | "single" | "unchecked";

export interface PulseFacet {
  key: PulseKey;
  label: string;
  count: number;
  tone: "hot" | "good" | "bad" | "warm" | "dim";
  /** The exact rule that produced the count. */
  detail: string;
}

export interface NewsPulse {
  as_of: number;
  /** Hours of coverage the pulse describes, or null when it fell back to a fixed story count. */
  window_hours: number | null;
  window_label: string;
  clusters: number;
  articles: number;
  outlets: number;
  headline: string;
  sub: string;
  facets: PulseFacet[];
  top_categories: { category: string; clusters: number }[];
  method: string;
}

export interface ClusterEvidence {
  claims: number;
  confirmed: number;
  corroborated: number;
  reported: number;
  disputed: number;
  verified: boolean;
  /** Highest tier reached by any claim in the story — the honest one-word summary. */
  best_tier: "confirmed" | "corroborated" | "reported" | "disputed" | "none";
}

const EMPTY_EVIDENCE: ClusterEvidence = {
  claims: 0, confirmed: 0, corroborated: 0, reported: 0, disputed: 0, verified: false, best_tier: "none",
};

/** Column names actually present, so a database provisioned before the evidence
 *  migration (the read-only demo path never runs ALTER TABLE) still answers. */
function columnsOf(table: string): Set<string> {
  try {
    const rows = getDb().prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    return new Set(rows.map((r) => r.name));
  } catch {
    return new Set();
  }
}

/**
 * Per-story claim tiers, keyed by cluster id.
 *
 * Tiers are read from the stored column when it exists and derived from support
 * counts when it does not, matching the fallback in the evidence route so the two
 * surfaces can never disagree.
 */
export function evidenceForClusters(ids: string[]): Map<string, ClusterEvidence> {
  const out = new Map<string, ClusterEvidence>();
  if (!ids.length) return out;
  const db = getDb();
  const cols = columnsOf("cluster_facts");
  const hasTier = cols.has("tier");
  const hasIndep = cols.has("independent_count");

  const select = [
    "cluster_id",
    hasTier ? "tier" : "NULL AS tier",
    hasIndep ? "independent_count" : "NULL AS independent_count",
    "support_count",
    "contradicted_by",
  ].join(", ");

  const placeholders = ids.map(() => "?").join(",");
  let rows: { cluster_id: string; tier: string | null; independent_count: number | null; support_count: number; contradicted_by: string | null }[] = [];
  try {
    rows = db
      .prepare(`SELECT ${select} FROM cluster_facts WHERE cluster_id IN (${placeholders})`)
      .all(...ids) as typeof rows;
  } catch {
    return out;
  }

  for (const r of rows) {
    const e = out.get(r.cluster_id) ?? { ...EMPTY_EVIDENCE };
    const tier = r.tier ?? deriveTier(r);
    e.claims += 1;
    if (tier === "confirmed") e.confirmed += 1;
    else if (tier === "corroborated") e.corroborated += 1;
    else if (tier === "disputed") e.disputed += 1;
    else if (tier === "reported") e.reported += 1;
    out.set(r.cluster_id, e);
  }

  // verify_status is the authoritative "has the evidence layer run" signal; the
  // presence of claims alone can be left over from an earlier schema.
  const statusCol = columnsOf("clusters");
  if (statusCol.has("verify_status")) {
    try {
      const st = db
        .prepare(`SELECT id, verify_status FROM clusters WHERE id IN (${placeholders})`)
        .all(...ids) as { id: string; verify_status: string | null }[];
      for (const s of st) {
        const e = out.get(s.id) ?? { ...EMPTY_EVIDENCE };
        e.verified = s.verify_status === "done";
        out.set(s.id, e);
      }
    } catch {
      /* pre-migration database — fall through to the claim-count heuristic */
    }
  }

  for (const [id, e] of out) {
    if (!e.verified && e.claims > 0) e.verified = true;
    e.best_tier =
      e.disputed > 0 ? "disputed"
        : e.confirmed > 0 ? "confirmed"
          : e.corroborated > 0 ? "corroborated"
            : e.reported > 0 ? "reported"
              : "none";
    out.set(id, e);
  }
  return out;
}

function deriveTier(r: { independent_count: number | null; support_count: number; contradicted_by: string | null }): string {
  if (r.contradicted_by) return "disputed";
  const n = r.independent_count ?? r.support_count ?? 0;
  if (n >= 3) return "confirmed";
  if (n === 2) return "corroborated";
  if (n === 1) return "reported";
  return "unverified";
}

interface PulseRow {
  id: string;
  category: string;
  first_seen: number;
  last_updated: number;
  article_count: number;
  source_count: number;
}

/** Minimum stories needed before the time-boxed window is considered meaningful. */
const MIN_WINDOW_CLUSTERS = 6;
const FALLBACK_LIMIT = 40;
const DEVELOPING_HOURS = 6;
const BREAKING_HOURS = 3;

export function newsPulse(opts: { windowHours?: number; now?: number } = {}): NewsPulse {
  const db = getDb();
  const now = opts.now ?? Date.now();
  const windowHours = opts.windowHours ?? HEAT_WINDOW_HOURS;

  const base = `
    SELECT c.id, c.category, c.first_seen, c.last_updated,
           COUNT(ca.article_id) AS article_count,
           COUNT(DISTINCT a.source_id) AS source_count
    FROM clusters c
    JOIN cluster_articles ca ON ca.cluster_id = c.id
    JOIN articles a ON a.id = ca.article_id`;

  let rows = db
    .prepare(`${base} WHERE c.last_updated > ? GROUP BY c.id`)
    .all(now - windowHours * 3_600_000) as PulseRow[];

  // A demo database seeded days ago would otherwise report an empty newsroom.
  // Fall back to the highest-heat stories on file — the same population the deck
  // ranks — and say plainly that this is no longer a live window.
  let effectiveWindow: number | null = windowHours;
  let windowLabel = `last ${windowHours}h`;
  if (rows.length < MIN_WINDOW_CLUSTERS) {
    rows = db
      .prepare(`${base} GROUP BY c.id ORDER BY c.trend_score DESC LIMIT ?`)
      .all(FALLBACK_LIMIT) as PulseRow[];
    effectiveWindow = null;
    windowLabel = `${rows.length} highest-heat ${rows.length === 1 ? "story" : "stories"} on file (nothing filed in the last ${windowHours}h)`;
  }

  const evidence = evidenceForClusters(rows.map((r) => r.id));

  const developing = rows.filter((r) => r.last_updated > now - DEVELOPING_HOURS * 3_600_000 && r.source_count >= 2);
  const breaking = rows.filter((r) => r.first_seen > now - BREAKING_HOURS * 3_600_000);
  const corroborated = rows.filter((r) => (evidence.get(r.id)?.confirmed ?? 0) > 0);
  const contested = rows.filter((r) => (evidence.get(r.id)?.disputed ?? 0) > 0);
  const single = rows.filter((r) => r.source_count <= 1);
  const unchecked = rows.filter((r) => !evidence.get(r.id)?.verified);

  const articles = rows.reduce((n, r) => n + r.article_count, 0);
  const outlets = (
    db.prepare(
      `SELECT COUNT(DISTINCT a.source_id) AS n
       FROM cluster_articles ca JOIN articles a ON a.id = ca.article_id
       WHERE ca.cluster_id IN (${rows.map(() => "?").join(",") || "''"})`,
    ).get(...rows.map((r) => r.id)) as { n: number } | undefined
  )?.n ?? 0;

  const byCategory = new Map<string, number>();
  for (const r of rows) byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + 1);
  const top_categories = [...byCategory.entries()]
    .map(([category, clusters]) => ({ category, clusters }))
    .sort((a, b) => b.clusters - a.clusters)
    .slice(0, 5);

  const facets: PulseFacet[] = [
    {
      key: "developing",
      label: "Developing",
      count: developing.length,
      tone: "hot",
      detail: `Gained a filing in the last ${DEVELOPING_HOURS}h and is carried by at least two outlets.`,
    },
    {
      key: "breaking",
      label: "Broke in the last 3h",
      count: breaking.length,
      tone: "hot",
      detail: `First filing in this cluster arrived within the last ${BREAKING_HOURS}h.`,
    },
    {
      key: "corroborated",
      label: "Corroborated",
      count: corroborated.length,
      tone: "good",
      detail: "At least one claim confirmed by three or more independent reporting chains.",
    },
    {
      key: "contested",
      label: "Sources conflict",
      count: contested.length,
      tone: "bad",
      detail: "At least one claim where outlets report incompatible facts. The disagreement is shown, not resolved.",
    },
    {
      key: "single",
      label: "Single outlet",
      count: single.length,
      tone: "warm",
      detail: "Only one outlet in the feed is carrying this. Nothing corroborates it yet.",
    },
    {
      key: "unchecked",
      label: "Not yet checked",
      count: unchecked.length,
      tone: "dim",
      detail: "The evidence layer has not run, so no claim in this story has been tiered.",
    },
  ];

  // The headline never inflates: if nothing is moving it says so rather than
  // relabelling the archive count as "developing".
  const headline =
    rows.length === 0
      ? "No coverage ingested yet"
      : developing.length > 0
        ? `${developing.length} ${plural(developing.length, "story", "stories")} developing`
        : `${rows.length} ${plural(rows.length, "story", "stories")} on the desk, none moving`;

  const subParts: string[] = [`across ${outlets} ${plural(outlets, "outlet", "outlets")}`, `${articles} ${plural(articles, "filing", "filings")}`];
  if (developing.length === 0 && rows.length > 0) subParts.push(`nothing new in ${DEVELOPING_HOURS}h`);
  if (contested.length) subParts.push(`${contested.length} with conflicting accounts`);
  if (corroborated.length) subParts.push(`${corroborated.length} corroborated by 3+ chains`);
  if (single.length) subParts.push(`${single.length} resting on a single outlet`);
  if (unchecked.length === rows.length && rows.length > 0) subParts.push("none checked against the evidence layer yet");

  return {
    as_of: now,
    window_hours: effectiveWindow,
    window_label: windowLabel,
    clusters: rows.length,
    articles,
    outlets,
    headline,
    sub: subParts.join(" · "),
    facets,
    top_categories,
    method:
      "Counts over stored columns for the stories in the stated window. 'Developing' and 'broke in the last 3h' come from filing timestamps; 'corroborated', 'sources conflict' and 'not yet checked' come from the claim tiers in the evidence layer. No model is involved and no figure is normalised.",
  };
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}
