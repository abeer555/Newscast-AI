"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, fmtDuration, timeAgo, useStore, useInterval } from "@/lib/store";
import AudioPlayer from "@/components/AudioPlayer";

interface Ep {
  id: string; title: string; status: string; format: string; language: string; audio_path: string | null;
  audio_duration: number | null; evaluation: { overall?: number; verdict?: string; publish_confidence?: number; decision?: string; reasons?: string[] } | null; created_at: number; updated_at: number;
  play_count: number; stage_label: string; progress: number; cluster_category: string | null;
}

export default function LibraryPage() {
  const [eps, setEps] = useState<Ep[]>([]);
  const [loading, setLoading] = useState(true);
  const episodeProgress = useStore((s) => s.episodeProgress);
  const pushToast = useStore((s) => s.pushToast);

  const load = async () => {
    const j = await api<{ episodes: Ep[] }>("/api/episodes");
    setEps(j.episodes);
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);
  const anyRunning = eps.some((e) => !["ready", "failed"].includes(e.status));
  useInterval(load, anyRunning ? 3000 : null);
  useInterval(load, 20000);

  const del = async (id: string) => {
    await api(`/api/episodes/${id}`, { method: "DELETE" });
    pushToast("Episode deleted", "info");
    load();
  };

  const ready = eps.filter((e) => e.status === "ready");
  const needsReview = eps.filter((e) => e.status === "needs_review");
  const inFlight = eps.filter((e) => !["ready", "failed", "needs_review"].includes(e.status));
  const failed = eps.filter((e) => e.status === "failed");

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Podcast Library</h1>
          <div className="page-sub">Every episode your newsroom has produced.</div>
        </div>
        <Link href="/" className="btn primary">＋ New episode</Link>
      </div>

      {inFlight.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div className="label" style={{ fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase", color: "var(--text-3)", fontWeight: 600, marginBottom: 10 }}>On the line</div>
          <div className="grid c2">
            {inFlight.map((e) => {
              const live = episodeProgress[e.id];
              return (
                <Link href={`/studio/${e.id}`} key={e.id} className="card pad">
                  <div style={{ fontWeight: 600, fontSize: 14.5, marginBottom: 8 }}>{e.title === "Generating…" ? "New episode" : e.title}</div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 6 }}>
                    <span className="muted">{live?.stageLabel ?? e.stage_label}</span>
                    <span className="mono dim">{Math.round((live?.progress ?? e.progress) * 100)}%</span>
                  </div>
                  <div className="progress-track"><div className="progress-fill" style={{ width: `${(live?.progress ?? e.progress) * 100}%` }} /></div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {loading ? <div className="skeleton" style={{ height: 300 }} /> : ready.length === 0 && inFlight.length === 0 && needsReview.length === 0 ? (
        <div className="card pad" style={{ textAlign: "center", padding: 60 }}>
          <div style={{ fontSize: 42, marginBottom: 12 }}>🎙</div>
          <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>No episodes yet</div>
          <div className="muted">Pick a story on the Command Deck and hit <b>Produce podcast</b>.</div>
        </div>
      ) : (
        <>
          {needsReview.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div className="label" style={{ fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase", color: "var(--warm)", fontWeight: 600, marginBottom: 10 }}>⚠ Needs human review (low confidence)</div>
              <div className="grid c3">
                {needsReview.map((e) => (
                  <Link key={e.id} href={`/studio/${e.id}`} className="card pad" style={{ borderLeft: "3px solid var(--warm)", display: "block" }}>
                    <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                      <span className="chip ai">{e.format}</span>
                      <span className="chip src">{e.format}</span>
                      {e.cluster_category && <span className="chip cat">{e.cluster_category}</span>}
                      {typeof e.evaluation?.publish_confidence === "number" && (
                        <span className="chip warm">{Math.round((e.evaluation.publish_confidence as number) * 100)}% conf</span>
                      )}
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 14.5, lineHeight: 1.4, marginBottom: 6 }}>{e.title}</div>
                    <div className="page-sub" style={{ fontSize: 12.5 }}>{e.evaluation?.reasons?.slice(0, 2).join(" · ") || "Held below publish threshold — review and override in Studio."}</div>
                    <div className="dim" style={{ fontSize: 11.5, marginTop: 8 }}>{timeAgo(e.created_at)}</div>
                  </Link>
                ))}
              </div>
            </div>
          )}
          <div className="grid c3">
          {ready.map((e) => (
            <div key={e.id} className="card pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                  <span className="chip ai">{e.format}</span>
                  <span className="chip src">{e.format}</span>
                  {e.cluster_category && <span className="chip cat">{e.cluster_category}</span>}
                  {typeof e.evaluation?.publish_confidence === "number" ? (
                    <span className={e.evaluation.publish_confidence >= 0.72 ? "chip good" : "chip warm"} title={(e.evaluation.reasons ?? []).join(" · ")}>
                      ✓ {Math.round((e.evaluation.publish_confidence as number) * 100)}%
                    </span>
                  ) : (e.evaluation?.overall != null ? <span className="chip good">★ {e.evaluation.overall}</span> : null)}
                </div>
                <Link href={`/studio/${e.id}`} style={{ fontWeight: 650, fontSize: 15.5, lineHeight: 1.4 }}>{e.title}</Link>
              </div>
              {e.audio_path && <AudioPlayer compact src={`${e.audio_path}?v=${e.updated_at ?? e.created_at}`} episodeId={e.id} duration={e.audio_duration} />}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "auto" }}>
                <span className="dim" style={{ fontSize: 12 }}>{fmtDuration(e.audio_duration)} · {e.play_count} plays · {timeAgo(e.created_at)}</span>
                <div style={{ display: "flex", gap: 6 }}>
                  <Link href={`/studio/${e.id}`} className="btn sm">Studio</Link>
                  <button className="btn sm danger" onClick={() => del(e.id)}>✕</button>
                </div>
              </div>
            </div>
          ))}
          </div>
        </>
      )}

      {failed.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div className="label" style={{ fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase", color: "var(--text-3)", fontWeight: 600, marginBottom: 10 }}>Needs attention</div>
          <div className="grid c3">
            {failed.map((e) => (
              <div key={e.id} className="card pad" style={{ borderColor: "rgba(255,107,107,0.3)" }}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>{e.title === "Generating…" ? "Episode (interrupted)" : e.title}</div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span className="chip trend">✕ failed</span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button className="btn sm primary" onClick={async () => { await api(`/api/episodes/${e.id}/synthesize`, { method: "POST" }); pushToast("Resuming…", "info"); load(); }}>Resume</button>
                    <Link href={`/studio/${e.id}`} className="btn sm">Open</Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
