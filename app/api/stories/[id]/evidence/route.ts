import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const cluster = db.prepare("SELECT id, title, intelligence FROM clusters WHERE id=?").get(id) as { id: string; title: string; intelligence: string | null } | undefined;
  if (!cluster) return NextResponse.json({ error: "not found" }, { status: 404 });

  const facts = db.prepare("SELECT id, claim, status, support_count, canonical_origins, attestation_json, contradicted_by, confidence, first_seen, last_seen FROM cluster_facts WHERE cluster_id=? ORDER BY confidence DESC").all(id) as Record<string, unknown>[];
  const living = db.prepare("SELECT current_summary, current_summary_at, version, timeline, last_fused_at FROM living_story WHERE cluster_id=?").get(id) as Record<string, unknown> | undefined;
  const editorial = db.prepare("SELECT * FROM editorials WHERE cluster_id=?").get(id) as Record<string, unknown> | undefined;

  // episodes on this cluster joined w/ publish gate if any
  const episodes = db.prepare("SELECT id, title, status FROM episodes WHERE cluster_id=?").all(id) as { id: string; title: string; status: string }[];
  const gates = db.prepare("SELECT * FROM publish_gates WHERE episode_id IN (SELECT id FROM episodes WHERE cluster_id=?) ORDER BY decided_at DESC").all(id) as Record<string, unknown>[];

  return NextResponse.json({
    cluster_id: id,
    title: cluster.title,
    intelligence: cluster.intelligence ? JSON.parse(cluster.intelligence) : null,
    facts: facts.map((f) => ({
      ...f,
      attestation_json: JSON.parse(f.attestation_json as string),
      canonical_origins: JSON.parse(f.canonical_origins as string),
    })),
    contradictions: facts.filter((f) => f.contradicted_by).map((f) => ({
      fact_id: f.id,
      claim: f.claim,
      contradicts: f.contradicted_by,
    })),
    living_story: living ? { ...living, timeline: JSON.parse(living.timeline as string) } : null,
    editorial: editorial ? (() => {
      const parseMaybe = (raw: unknown) => {
        if (typeof raw !== "string") return raw;
        if (raw.startsWith("[") || raw.startsWith("{")) {
          try { return JSON.parse(raw); } catch { return raw; }
        }
        return raw;
      };
      return {
        bias_json: JSON.parse(editorial.bias_json as string),
        whats_solid: parseMaybe(editorial.whats_solid),
        whats_contested: parseMaybe(editorial.whats_contested),
        whats_unknown: parseMaybe(editorial.whats_unknown),
        updated_at: editorial.updated_at,
      };
    })() : null,
    episodes,
    gates,
  });
}
