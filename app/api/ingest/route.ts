import { NextResponse } from "next/server";
import { fetchAllSources } from "@/lib/ingest";
import { clusterRecent } from "@/lib/cluster";
import { getDb } from "@/lib/db";

export const maxDuration = 120;

export async function POST() {
  const results = await fetchAllSources();
  const clustering = clusterRecent(48);
  const db = getDb();
  const counts = {
    articles: (db.prepare("SELECT COUNT(*) c FROM articles").get() as { c: number }).c,
    clusters: (db.prepare("SELECT COUNT(*) c FROM clusters").get() as { c: number }).c,
  };
  return NextResponse.json({ sources: results, clustering, counts });
}
