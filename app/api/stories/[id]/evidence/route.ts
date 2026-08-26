import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { analyzeCoverage } from "@/lib/coverage";
import { citeText, splitForecasts, CITE_THRESHOLD, type CitableFact } from "@/lib/cite";
import { metricsFor } from "@/lib/enrich";
import { INDEPENDENCE_METHOD, type ArticleLike } from "@/lib/independence";
import { CONFIDENCE_METHOD, TIER_METHOD, type Attestation, type ClaimTier } from "@/lib/verification";
import { verifyStatusOf } from "@/lib/verifyStory";
import type { StoryIntelligence } from "@/lib/intelligence";

interface FactRow {
  id: string;
  claim: string;
  status: string;
  support_count: number;
  canonical_origins: string;
  attestation_json: string;
  contradicted_by: string | null;
  confidence: number;
  first_seen: number;
  last_seen: number;
  /* Added by the evidence-layer migration. Optional so a database provisioned
     before the migration (the read-only demo path never runs ALTER TABLE) still
     serves this route instead of 500-ing on a missing column. */
  tier?: string | null;
  tier_reason?: string | null;
  outlet_count?: number | null;
  independent_count?: number | null;
  variants_json?: string | null;
  topic?: string | null;
  first_reported_by?: string | null;
  first_reported_at?: number | null;
}

const TIER_ORDER: Record<string, number> = { confirmed: 0, corroborated: 1, disputed: 2, reported: 3, unverified: 4 };

/** Older rows predate the tier column; derive one so the UI never shows a blank badge. */
function tierOf(f: FactRow): ClaimTier {
  if (f.tier) return f.tier as ClaimTier;
  if (f.contradicted_by) return "disputed";
  const n = f.independent_count ?? f.support_count ?? 0;
  if (n >= 3) return "confirmed";
  if (n === 2) return "corroborated";
  if (n === 1) return "reported";
  return "unverified";
}

function parseList(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  const s = raw.trim();
  if (!s) return [];
  if (s.startsWith("[")) {
    try {
      const v = JSON.parse(s);
      return Array.isArray(v) ? v.map(String) : [String(v)];
    } catch {
      return [s];
    }
  }
  return [s];
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const cluster = db
    .prepare("SELECT id, title, intelligence, first_seen, last_updated FROM clusters WHERE id=?")
    .get(id) as { id: string; title: string; intelligence: string | null; first_seen: number; last_updated: number } | undefined;
  if (!cluster) return NextResponse.json({ error: "not found" }, { status: 404 });

  const intelligence = cluster.intelligence ? (JSON.parse(cluster.intelligence) as StoryIntelligence) : null;

  const factRows = db
    .prepare("SELECT * FROM cluster_facts WHERE cluster_id=?")
    .all(id) as FactRow[];

  const facts = factRows
    .map((f) => {
      let attestations: Attestation[] = [];
      try {
        attestations = JSON.parse(f.attestation_json) as Attestation[];
      } catch {
        attestations = [];
      }
      const tier = tierOf(f);
      const outletNames = [...new Set(attestations.map((a) => a.source).filter(Boolean))];
      const chains = [...new Set(attestations.map((a) => a.chain_label).filter(Boolean))];
      return {
        id: f.id,
        claim: f.claim,
        tier,
        tier_label: TIER_METHOD[tier],
        tier_reason:
          f.tier_reason ??
          `${f.independent_count ?? f.support_count} independent reporting ${(f.independent_count ?? f.support_count) === 1 ? "chain" : "chains"} carried this claim.`,
        status: f.status,
        confidence: f.confidence,
        support_count: f.support_count,
        outlet_count: f.outlet_count ?? outletNames.length,
        independent_count: f.independent_count ?? chains.length ?? 0,
        outlets: outletNames,
        chains,
        origins: parseList(f.canonical_origins),
        variants: parseList(f.variants_json),
        attestations,
        contradicted_by: parseList(f.contradicted_by),
        topic: f.topic,
        first_reported_by: f.first_reported_by,
        first_reported_at: f.first_reported_at,
        first_seen: f.first_seen,
        last_seen: f.last_seen,
      };
    })
    .sort((a, b) => (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9) || b.independent_count - a.independent_count || b.confidence - a.confidence);

  const byId = new Map(facts.map((f) => [f.id, f]));
  const contradictions = facts
    .filter((f) => f.contradicted_by.length)
    .map((f) => ({
      fact_id: f.id,
      claim: f.claim,
      claim_sources: f.outlets,
      against: f.contradicted_by
        .map((oid) => {
          const other = byId.get(oid);
          return other ? { fact_id: other.id, claim: other.claim, sources: other.outlets } : null;
        })
        .filter(Boolean),
    }))
    // Each pair appears from both sides; keep one representative per pair.
    .filter((c, _i, all) => {
      const partner = c.against[0];
      if (!partner) return true;
      const mirrored = all.find((x) => x.fact_id === partner.fact_id);
      return !mirrored || c.fact_id < partner.fact_id;
    });

  const living = db
    .prepare("SELECT current_summary, current_summary_at, version, timeline, last_fused_at FROM living_story WHERE cluster_id=?")
    .get(id) as Record<string, unknown> | undefined;
  const editorial = db.prepare("SELECT * FROM editorials WHERE cluster_id=?").get(id) as Record<string, unknown> | undefined;

  const episodes = db.prepare("SELECT id, title, status FROM episodes WHERE cluster_id=?").all(id) as { id: string; title: string; status: string }[];
  const gates = (db
    .prepare("SELECT * FROM publish_gates WHERE episode_id IN (SELECT id FROM episodes WHERE cluster_id=?) ORDER BY decided_at DESC")
    .all(id) as Record<string, unknown>[]).map((g) => ({
    ...g,
    reasons: (() => {
      try {
        return JSON.parse(String(g.reasons));
      } catch {
        return [];
      }
    })(),
  }));

  const coverage = analyzeCoverage(id, intelligence);

  const articles = db
    .prepare(
      `SELECT a.id, a.source_id, s.name AS source_name, s.lean, a.author, a.published_at, a.title, a.summary
       FROM cluster_articles ca JOIN articles a ON a.id=ca.article_id JOIN sources s ON s.id=a.source_id
       WHERE ca.cluster_id=?`,
    )
    .all(id) as ArticleLike[];
  const metrics = metricsFor({
    articles,
    firstSeen: cluster.first_seen,
    scoredAt: cluster.last_updated,
  });

  const tierCounts: Record<string, number> = {};
  for (const f of facts) tierCounts[f.tier] = (tierCounts[f.tier] ?? 0) + 1;

  // Inline citation: every sentence of the generated narrative mapped back to the
  // claims that support it, computed here because the matcher needs the tokeniser
  // from the verification layer (which is server-only).
  const citable: CitableFact[] = facts.map((f) => ({
    id: f.id,
    claim: f.claim,
    tier: f.tier,
    outlets: f.outlets,
    independent_count: f.independent_count,
    confidence: f.confidence,
  }));
  const narrative = {
    story: citeText(intelligence?.summary_long, citable),
    why: citeText(intelligence?.why_it_matters, citable),
    lede: citeText(intelligence?.lede, citable),
    next: splitForecasts(intelligence?.what_next),
    threshold: CITE_THRESHOLD,
  };

  return NextResponse.json({
    cluster_id: id,
    title: cluster.title,
    intelligence,
    verification: { ...verifyStatusOf(id), fact_count: facts.length, tiers: tierCounts },
    facts,
    tier_counts: tierCounts,
    contradictions,
    coverage,
    metrics,
    narrative,
    known: {
      // The editorial pass already produced these three buckets; they were
      // computed and then never rendered.
      solid: parseList(editorial?.whats_solid),
      contested: parseList(editorial?.whats_contested),
      unknown: parseList(editorial?.whats_unknown),
      consensus: intelligence?.consensus ?? [],
      disagreements: intelligence?.disagreements ?? [],
      updated_at: editorial?.updated_at ?? null,
    },
    living_story: living ? { ...living, timeline: JSON.parse(String(living.timeline)) } : null,
    editorial: editorial
      ? {
          bias_json: (() => {
            try {
              return JSON.parse(String(editorial.bias_json));
            } catch {
              return [];
            }
          })(),
          updated_at: editorial.updated_at,
        }
      : null,
    episodes,
    gates,
    methods: {
      confidence: CONFIDENCE_METHOD,
      independence: INDEPENDENCE_METHOD,
      tiers: TIER_METHOD,
      coverage: coverage.method,
    },
  });
}
