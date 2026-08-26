/**
 * Story verification runner.
 *
 * Verification used to be a side effect of generating a podcast, which meant the
 * evidence dossier was empty until you asked for audio — exactly backwards.
 * Facts are a property of the reporting, not of the broadcast. This module runs
 * the evidence layer directly against a cluster so the dossier is populated the
 * moment a story is analysed, and can be re-run on demand from the UI.
 */

import { getDb } from "./db";
import { logEvent } from "./bus";
import { attestClaims, detectContradictions, type Contradiction, type VerifiedFact } from "./verification";
import { fuseStory } from "./living";

export type VerifyStatus = "idle" | "running" | "done" | "failed";

export interface VerifyResult {
  cluster_id: string;
  status: VerifyStatus;
  verified_at: number | null;
  facts: VerifiedFact[];
  contradictions: Contradiction[];
  /** True when the narrative fusion / editorial pass also ran. */
  fused: boolean;
  error: string | null;
  tiers: Record<string, number>;
}

function setStatus(clusterId: string, status: VerifyStatus, at?: number) {
  const db = getDb();
  try {
    db.prepare("UPDATE clusters SET verify_status=?, verified_at=COALESCE(?, verified_at) WHERE id=?").run(
      status,
      at ?? null,
      clusterId,
    );
  } catch {
    // Read-only deployments never ran the ALTER TABLE that adds these columns.
    // Losing the status marker is cosmetic; verification itself still returns.
  }
}

export function verifyStatusOf(clusterId: string): { status: VerifyStatus; verified_at: number | null } {
  const db = getDb();
  try {
    const row = db.prepare("SELECT verify_status, verified_at FROM clusters WHERE id=?").get(clusterId) as
      | { verify_status: string | null; verified_at: number | null }
      | undefined;
    return {
      status: (row?.verify_status as VerifyStatus) ?? "idle",
      verified_at: row?.verified_at ?? null,
    };
  } catch {
    return { status: "idle", verified_at: null };
  }
}

/**
 * Extracts claims, cross-attests them across outlets, flags contradictions and
 * (optionally) refreshes the fused narrative + editorial comparison.
 *
 * @param fuse  Run the narrative/editorial pass too. Costs one extra model call
 *              per story; skipped when a recent fusion already exists.
 */
export async function verifyStory(clusterId: string, opts: { fuse?: boolean; force?: boolean } = {}): Promise<VerifyResult> {
  const db = getDb();
  const exists = db.prepare("SELECT id FROM clusters WHERE id=?").get(clusterId);
  if (!exists) throw new Error("cluster not found");

  setStatus(clusterId, "running");
  logEvent("verify", `Verifying claims for ${clusterId}`);

  try {
    const facts = await attestClaims(clusterId);
    const contradictions = detectContradictions(facts);

    const tiers: Record<string, number> = {};
    for (const f of facts) tiers[f.tier] = (tiers[f.tier] ?? 0) + 1;

    let fused = false;
    if (opts.fuse) {
      const prior = db.prepare("SELECT last_fused_at FROM living_story WHERE cluster_id=?").get(clusterId) as
        | { last_fused_at: number }
        | undefined;
      const latest = db.prepare(
        "SELECT MAX(a.published_at) AS t FROM cluster_articles ca JOIN articles a ON a.id=ca.article_id WHERE ca.cluster_id=?",
      ).get(clusterId) as { t: number | null };
      const stale = !prior || (latest.t ?? 0) > prior.last_fused_at;
      if (stale || opts.force) {
        try {
          await fuseStory(clusterId);
          fused = true;
        } catch (e) {
          // Fusion is a narrative nicety; claim-level evidence still stands
          // without it, so a failure here must not fail verification.
          logEvent("verify", `Narrative fusion skipped: ${(e as Error).message}`);
        }
      }
    }

    const at = Date.now();
    setStatus(clusterId, "done", at);
    logEvent(
      "verify",
      `Verified ${facts.length} claims · ${tiers.confirmed ?? 0} confirmed · ${contradictions.length} disputed`,
      { cluster_id: clusterId, tiers },
    );

    return {
      cluster_id: clusterId,
      status: "done",
      verified_at: at,
      facts,
      contradictions,
      fused,
      error: null,
      tiers,
    };
  } catch (e) {
    setStatus(clusterId, "failed");
    logEvent("verify", `Verification failed: ${(e as Error).message}`);
    return {
      cluster_id: clusterId,
      status: "failed",
      verified_at: null,
      facts: [],
      contradictions: [],
      fused: false,
      error: (e as Error).message,
      tiers: {},
    };
  }
}
