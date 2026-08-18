"use client";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, useStore, timeAgo, fmtDuration, useInterval } from "@/lib/store";
import AudioPlayer from "@/components/AudioPlayer";

interface Segment { index: number; speaker: string; voice: string; direction: string; text: string; }
interface Script { title: string; description: string; tags: string[]; hosts: { name: string; role: string; voice: string }[]; segments: Segment[]; estimated_seconds: number; }
interface Evaluation {
  // legacy shape (older episodes)
  scores?: Record<string, number>;
  overall?: number;
  verdict?: string;
  strengths?: string[];
  improvements?: string[];
  fact_check_notes?: string;
  summary?: string;
  // new shape (evidence pipeline)
  publish_confidence?: number;
  decision?: "publish" | "needs_review";
  reasons?: string[];
  syndication_handling?: number;
  contradiction_disclosure?: number;
  subtitle_sync?: number;
  visual_relevance?: number;
  audio_quality?: number;
}
interface Episode {
  id: string; cluster_id: string; title: string; format: string; language: "en" | "ar"; status: string; progress: number; stage_label: string;
  error: string | null; script: Script | null; audio_path: string | null; audio_duration: number | null; evaluation: Evaluation | null;
  created_at: number; updated_at: number; script_model: string | null; play_count: number;
  video_status: string | null; video_path: string | null; video_duration: number | null; video_error: string | null; video_mode?: "local" | "article_images";
  storyboard: { beats: { index: number; image_prompt: string; caption: string; duration: number; frame_path?: string; image_source?: "article" | "ai_generated"; quality_score?: number; original_url?: string }[]; total_duration: number } | null;
}

const DIRECTIONS = ["", "cheerful", "warm", "casual", "serious", "thoughtful", "curious", "professionally", "authoritatively", "excited", "urgent", "somber", "deadpan", "whisper"];

export default function StudioPage() {
  const { id } = useParams<{ id: string }>();
  const { pushToast, episodeProgress } = useStore((s) => ({ pushToast: s.pushToast, episodeProgress: s.episodeProgress }));
  const [ep, setEp] = useState<Episode | null>(null);
  const [draft, setDraft] = useState<Script | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"script" | "listen" | "watch" | "review">("script");
  const [videoBusy, setVideoBusy] = useState(false);
  const [videoMode, setVideoMode] = useState<"local" | "article_images">("local");
  const [showLangPicker, setShowLangPicker] = useState(false);

  const load = async () => {
    const j = await api<Episode>(`/api/episodes/${id}`);
    setEp(j);
    // Always update draft when new script arrives from server, unless user is actively editing
    if (j.script && (!dirty || j.status === "ready")) {
      setDraft(j.script);
      setDirty(false);
    }
    if (j.status === "ready" && j.audio_path) setTab((t) => (t === "script" && !dirty ? "listen" : t));
  };
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [id]);
  const live = episodeProgress[id];
  const running = ep && !["ready", "failed", "script_ready", "draft"].includes(ep.status);
  // Poll more frequently (1 second) during pipeline execution for faster UI updates
  useInterval(() => { if (running) void load(); }, running ? 1000 : null);
  // poll while the detached video worker renders
  const videoRunning = ep && (ep.video_status === "queued" || ep.video_status === "storyboard" || ep.video_status === "rendering");
  useInterval(() => { if (videoRunning) void load(); }, videoRunning ? 3000 : null);

  const renderVideo = async () => {
    setVideoBusy(true);
    try {
      await api(`/api/episodes/${id}/video`, { method: "POST", body: JSON.stringify({ video_mode: videoMode }) });
      pushToast(`Video render queued (${videoMode === "local" ? "AI imagery" : "Article images"})`, "good");
    } catch (e) {
      pushToast(String(e), "bad");
    } finally {
      setVideoBusy(false);
    }
  };

  const regenerateWithCritique = async () => {
    if (!ep?.evaluation?.improvements) return;
    setBusy(true);
    try {
      await api(`/api/episodes/${id}/regenerate`, { method: "POST", body: JSON.stringify({ critique: ep.evaluation.improvements }) });
      pushToast("Regenerating script based on Editor critique...", "good");
      setDirty(false); // Clear any local edits
      // Force immediate reload to show pipeline status
      await load();
    } catch (e) {
      pushToast(String(e), "bad");
    } finally {
      setBusy(false);
    }
  };
  const recreateInLanguage = async (lang: string) => {
    if (!ep) return;
    setShowLangPicker(false);
    try {
      const { id: newId } = await api<{ id: string }>("/api/episodes", {
        method: "POST",
        body: JSON.stringify({ clusterId: ep.cluster_id, format: ep.format, language: lang, style: "conversational" }),
      });
      pushToast("Recreating episode in new language...", "good");
      window.location.href = `/studio/${newId}`;
    } catch (e) { pushToast(String(e), "bad"); }
  };

  const stageIndex = useMemo(() => {
    const s = ep?.status ?? "queued";
    if (["queued", "analyzing"].includes(s)) return 0;
    if (["scripting"].includes(s)) return 1;
    if (["script_ready"].includes(s)) return 2;
    if (["synthesizing"].includes(s)) return 3;
    if (["evaluating"].includes(s)) return 4;
    if (s === "ready") return 5;
    return 0;
  }, [ep?.status]);

  const save = async (invalidate: boolean) => {
    if (!draft) return;
    setBusy(true);
    await api(`/api/episodes/${id}`, { method: "PATCH", body: JSON.stringify({ title: draft.title, script: draft, invalidateAudio: invalidate }) });
    setDirty(false);
    setBusy(false);
    pushToast(invalidate ? "Script saved — audio needs re-synthesis" : "Script saved", "good");
    await load();
  };

  const synthesize = async () => {
    setBusy(true);
    try {
      if (dirty && draft) {
        await api(`/api/episodes/${id}`, { method: "PATCH", body: JSON.stringify({ title: draft.title, script: draft, invalidateAudio: true }) });
        setDirty(false);
      }
      await api(`/api/episodes/${id}/synthesize`, { method: "POST" });
      pushToast("Synthesis started", "good");
      await load();
    } catch (e) { pushToast(`${e}`, "bad"); }
    setBusy(false);
  };

  if (!ep) return <div style={{ padding: 40 }}><div className="skeleton" style={{ height: 320 }} /></div>;
  const termsIssue = ep.error?.includes("terms acceptance") || ep.error?.includes("model_terms_required");
  const progressPct = Math.round(((live?.progress ?? ep.progress) || 0) * 100);
  const stageLabel = live?.stageLabel ?? ep.stage_label ?? "";

  return (
    <div>
      <Link href="/library" className="dim" style={{ fontSize: 13 }}>← Library</Link>
      <div className="page-head" style={{ marginTop: 10 }}>
        <div style={{ maxWidth: 760 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
            <span className="chip ai">{ep.format}</span>
            <span className="chip src">{ep.script_model ?? "…"}</span>
            <StatusPill status={ep.status} />
          </div>
          {draft && !running && ep.status !== "queued" ? (
            <input
              value={draft.title}
              onChange={(e) => { setDraft({ ...draft, title: e.target.value }); setDirty(true); }}
              style={{ background: "transparent", border: "none", outline: "none", color: "var(--text)", fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 700, width: "100%" }}
            />
          ) : (
            <h1 className="page-title" style={{ fontSize: 26 }}>{ep.title}</h1>
          )}
          <div className="page-sub">Episode · created {timeAgo(ep.created_at)}{ep.audio_duration ? ` · ${fmtDuration(ep.audio_duration)}` : ""}</div>
        </div>
        <div style={{ display: "flex", gap: 10, flexShrink: 0, alignItems: "center" }}>
          {dirty && <button className={`btn ${busy ? "loading spin-light" : ""}`} onClick={() => save(true)} disabled={busy}>Save script</button>}
          {(ep.status === "script_ready" || (ep.status === "failed" && draft)) && (
            <button className={`btn primary ${busy ? "loading" : ""}`} onClick={synthesize} disabled={busy}>
              {ep.audio_path ? "Re-synthesize audio" : "Synthesize audio"}
            </button>
          )}
          <button className="btn sm" onClick={() => setShowLangPicker(true)} title="Recreate in different language" style={{ gap: 6 }}>🌐 Language</button>
          {ep.status === "ready" && <span className="chip good" style={{ alignSelf: "center", padding: "8px 14px", fontSize: 13 }}>✓ On air</span>}
        </div>
      </div>
      {showLangPicker && <LangPickerModal currentLang={ep.language} onClose={() => setShowLangPicker(false)} onPick={recreateInLanguage} />}

      {/* pipeline stages */}
      <div className="card pad" style={{ marginBottom: 20 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
          {["Analyze", "Write script", "Edit", "Synthesize", "Evaluate"].map((s, i) => {
            const done = stageIndex > i || (i === 4 && ep.status === "ready");
            const active = stageIndex === i + (running ? 0 : 0) && running ? stageIndex === i : false;
            return (
              <div key={s} style={{ textAlign: "center" }}>
                <div style={{ height: 4, borderRadius: 99, background: done ? "var(--accent)" : stageIndex === i && (running || ep.status === "script_ready") ? "linear-gradient(90deg,var(--accent),var(--accent-2))" : "var(--panel-3)", marginBottom: 8, transition: "all 0.4s" }} />
                <div style={{ fontSize: 12, color: done || (stageIndex === i && (running || ep.status === "script_ready")) ? "var(--text)" : "var(--text-3)" }}>{s}</div>
              </div>
            );
          })}
        </div>
        {(running || ep.status === "failed") && (
          <div style={{ marginTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 7 }}>
              <span className="muted">{stageLabel}{running && <span className="eq" style={{ marginLeft: 8 }}><span /><span /><span /><span /></span>}</span>
              <span className="mono dim">{progressPct}%</span>
            </div>
            <div className="progress-track" style={{ height: 9 }}>
              <div className="progress-fill" style={{ width: `${progressPct}%`, background: ep.status === "failed" ? "var(--bad)" : undefined }} />
            </div>
            {ep.status === "failed" && (
              <div style={{ marginTop: 12, padding: "12px 14px", borderRadius: 10, background: "rgba(255,107,107,0.08)", border: "1px solid rgba(255,107,107,0.3)", fontSize: 13 }}>
                <div style={{ lineHeight: 1.6 }}>
                  <div style={{ color: "var(--red)", fontWeight: 600, marginBottom: 8 }}>Pipeline error: {ep.error}</div>
                  <div className="dim">The generation pipeline failed at the <b>{ep.stage_label.toLowerCase()}</b> stage. You can retry synthesis or run the pipeline again.</div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        {(["script", "listen", "watch", "review"] as const).map((t) => (
          <button key={t} className="btn sm" onClick={() => setTab(t)}
            style={{ background: tab === t ? "var(--panel-3)" : "var(--panel)", color: tab === t ? "var(--accent)" : "var(--text-2)" }}>
            {t === "script" ? `Script${draft ? ` (${draft.segments.length})` : ""}` : t === "listen" ? "Listen" : t === "watch" ? "Watch" : "Quality review"}
          </button>
        ))}
      </div>

      {tab === "script" && draft && (
        <div className="grid" style={{ gap: 12 }}>
          <div className="card pad" style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            {draft.hosts.map((h) => (
              <span key={h.name} className="chip ai">🎙 {h.name} <span className="dim">· {h.role} · {h.voice}</span></span>
            ))}
            <span className="chip">tags: {draft.tags.join(", ")}</span>
            <span className="chip warm">~{fmtDuration(draft.estimated_seconds)} spoken</span>
          </div>
          {draft.segments.map((seg, i) => (
            <div key={i} className="card pad" style={{ display: "grid", gridTemplateColumns: "150px 150px 1fr", gap: 14, alignItems: "start" }}>
              <div>
                <select
                  value={seg.speaker}
                  onChange={(e) => {
                    const host = draft.hosts.find((h) => h.name === e.target.value) ?? draft.hosts[0];
                    const segs = [...draft.segments];
                    segs[i] = { ...seg, speaker: host.name, voice: host.voice };
                    setDraft({ ...draft, segments: segs }); setDirty(true);
                  }}
                  className="btn sm" style={{ width: "100%", background: "var(--panel-2)", color: "var(--accent)" }}
                >
                  {draft.hosts.map((h) => <option key={h.name} value={h.name}>🎙 {h.name}</option>)}
                </select>
                {ep.language === "en" && (
                  <select
                    value={seg.direction}
                    onChange={(e) => { const segs = [...draft.segments]; segs[i] = { ...seg, direction: e.target.value }; setDraft({ ...draft, segments: segs }); setDirty(true); }}
                    className="btn sm" style={{ width: "100%", marginTop: 6, background: "var(--panel-2)" }}
                  >
                    {DIRECTIONS.map((d) => <option key={d} value={d}>{d || "no direction"}</option>)}
                  </select>
                )}
              </div>
              <div className="mono dim" style={{ fontSize: 11.5, paddingTop: 8 }}>
                voice: {seg.voice}<br />
                {seg.text.length}/200 chars
                <div className="progress-track" style={{ height: 4, marginTop: 6 }}>
                  <div style={{ height: "100%", width: `${Math.min(100, (seg.text.length / 200) * 100)}%`, background: seg.text.length > 190 ? "var(--bad)" : seg.text.length > 150 ? "var(--warm)" : "var(--good)", borderRadius: 99 }} />
                </div>
              </div>
              <textarea
                value={seg.text}
                rows={2}
                onChange={(e) => { const segs = [...draft.segments]; segs[i] = { ...seg, text: e.target.value }; setDraft({ ...draft, segments: segs }); setDirty(true); }}
                style={{ width: "100%", background: "var(--bg-2)", border: "1px solid var(--line-soft)", borderRadius: 10, color: "var(--text)", padding: "10px 12px", fontSize: 14, lineHeight: 1.55, resize: "vertical", outline: "none" }}
              />
            </div>
          ))}
        </div>
      )}

      {tab === "listen" && (
        <div style={{ maxWidth: 820 }}>
          {ep.audio_path ? (
            <>
              <AudioPlayer 
                src={`${ep.audio_path}?v=${ep.updated_at ?? ep.created_at ?? Date.now()}`} 
                segments={ep.script?.segments} 
                duration={ep.audio_duration} 
                episodeId={ep.id} 
              />
              {ep.script && (
                <div className="card pad" style={{ marginTop: 14 }}>
                  <div className="label" style={{ fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase", color: "var(--text-3)", fontWeight: 600, marginBottom: 10 }}>Transcript</div>
                  <div style={{ display: "grid", gap: 8, maxHeight: 320, overflow: "auto" }}>
                    {ep.script.segments.map((s, i) => (
                      <div key={i} style={{ fontSize: 13.5, lineHeight: 1.55 }}>
                        <b style={{ color: s.index % 2 === 0 ? "var(--accent)" : "var(--accent-2)" }}>{s.speaker}: </b>{s.text}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="card pad" style={{ textAlign: "center", padding: 50 }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>🎧</div>
              <div className="muted">No audio yet — synthesize from the script stage.</div>
            </div>
          )}
        </div>
      )}

      {tab === "watch" && (
        <div style={{ maxWidth: 860 }}>
          {ep.video_path ? (
            <>
              <div className="card pad" style={{ padding: 8, background: "black" }}>
                <video key={ep.video_path} controls playsInline preload="metadata" style={{ width: "100%", borderRadius: 10, display: "block" }} src={`${ep.video_path}?v=${ep.updated_at}`} />
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, fontSize: 13 }} className="muted">
                <span className="chip good">✓ video ready</span>
                {ep.video_duration ? <span>{fmtDuration(ep.video_duration)}</span> : null}
                {ep.storyboard ? (() => {
                  const articleCount = ep.storyboard.beats.filter(b => b.image_source === "article").length;
                  const aiCount = ep.storyboard.beats.filter(b => b.image_source === "ai_generated").length;
                  if (articleCount > 0 && aiCount > 0) {
                    return <span>{ep.storyboard.beats.length} beats · Hybrid: {articleCount} article + {aiCount} AI</span>;
                  } else if (articleCount > 0) {
                    return <span>{ep.storyboard.beats.length} beats · Article Images</span>;
                  } else {
                    return <span>{ep.storyboard.beats.length} beats · {ep.video_mode === "article_images" ? "Article Images" : "Z-Image-Turbo 1280×720"}</span>;
                  }
                })() : null}
                <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  <select className="btn sm" style={{ background: "var(--bg-2)" }} value={videoMode} onChange={(e) => setVideoMode(e.target.value as "local" | "article_images")}>
                    <option value="local">🎨 AI Generated Images (ComfyUI)</option>
                    <option value="article_images">📰 Real Images Only (No AI)</option>
                  </select>
                  <button className={`btn sm ${videoBusy ? "loading" : ""}`} onClick={renderVideo} disabled={videoBusy}>Re-render</button>
                </div>
              </div>
              {ep.storyboard && (
                <div className="card pad" style={{ marginTop: 14 }}>
                  <div className="label" style={{ fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase", color: "var(--text-3)", fontWeight: 600, marginBottom: 10 }}>
                    Storyboard — how the video looks
                    {ep.storyboard.beats.some(b => b.image_source) && (() => {
                      const articleCount = ep.storyboard.beats.filter(b => b.image_source === "article").length;
                      const aiCount = ep.storyboard.beats.filter(b => b.image_source === "ai_generated").length;
                      return articleCount > 0 || aiCount > 0 ? (
                        <span style={{ marginLeft: 10, color: "var(--accent)", fontWeight: 500, textTransform: "none", fontSize: 11 }}>
                          {articleCount > 0 && <span>📰 {articleCount} from articles</span>}
                          {articleCount > 0 && aiCount > 0 && <span> · </span>}
                          {aiCount > 0 && <span>🎨 {aiCount} AI-generated</span>}
                        </span>
                      ) : null;
                    })()}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 10 }}>
                    {ep.storyboard.beats.map((b) => (
                      <details key={b.index} style={{ background: "var(--panel-2)", borderRadius: 10, padding: 8, position: "relative" }}>
                        {b.image_source && (
                          <div style={{ 
                            position: "absolute", 
                            top: 4, 
                            right: 4, 
                            fontSize: 10, 
                            padding: "2px 6px", 
                            borderRadius: 4, 
                            background: b.image_source === "article" ? "rgba(59, 130, 246, 0.15)" : "rgba(168, 85, 247, 0.15)",
                            color: b.image_source === "article" ? "#3b82f6" : "#a855f7",
                            fontWeight: 600
                          }}>
                            {b.image_source === "article" ? "📰 Article" : "🎨 AI"}
                          </div>
                        )}
                        <summary style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: "var(--accent)" }}>
                          {String(b.index + 1).padStart(2, "0")} · {b.caption || `Beat ${b.index + 1}`}
                        </summary>
                        <p className="muted" style={{ fontSize: 11.5, lineHeight: 1.5, margin: "8px 0 0" }}>{b.image_prompt || b.caption}</p>
                        <div className="mono dim" style={{ fontSize: 10.5, marginTop: 6 }}>{b.duration}s on screen</div>
                        {b.quality_score && (
                          <div style={{ fontSize: 10, marginTop: 4, color: b.quality_score >= 70 ? "var(--good)" : b.quality_score >= 40 ? "var(--warm)" : "var(--bad)" }}>
                            Quality: {b.quality_score}/100
                          </div>
                        )}
                        {b.original_url && (
                          <div style={{ fontSize: 10, marginTop: 4 }}>
                            <a href={b.original_url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
                              🔗 Source Image
                            </a>
                          </div>
                        )}
                      </details>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : videoRunning ? (
            <div className="card pad" style={{ textAlign: "center", padding: 50 }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>🎬</div>
              <div className="muted" style={{ marginBottom: 12 }}>
                {ep.video_status === "queued" ? "Queued — worker starting…" : ep.video_status === "storyboard" ? "Designing storyboard…" : "Rendering frames on your local Z-Image + stitching with ffmpeg…"}
              </div>
              <div className="progress-track" style={{ height: 8, maxWidth: 420, margin: "0 auto" }}>
                <div className="progress-fill" style={{ width: ep.video_status === "storyboard" ? "18%" : ep.video_status === "rendering" ? "60%" : "6%" }} />
              </div>
            </div>
          ) : ep.video_status === "failed" ? (
            <div className="card pad" style={{ textAlign: "center", padding: 50 }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>🎞</div>
              <div className="muted" style={{ marginBottom: 8 }}>Video render failed.</div>
              <div className="mono dim" style={{ fontSize: 12, marginBottom: 14, maxWidth: 560, marginInline: "auto", wordBreak: "break-word" }}>{ep.video_error}</div>
              <div style={{ display: "flex", gap: 8, justifyContent: "center", alignItems: "center" }}>
                <select className="btn sm" style={{ background: "var(--bg-2)" }} value={videoMode} onChange={(e) => setVideoMode(e.target.value as "local" | "article_images")}>
                  <option value="local">AI Video (ComfyUI)</option>
                  <option value="article_images">Direct Article Images</option>
                </select>
                <button className={`btn sm ${videoBusy ? "loading" : ""}`} onClick={renderVideo} disabled={videoBusy}>Try again</button>
                <a className="btn sm" href={`/api/episodes/${id}/video`} target="_blank" rel="noreferrer">raw status</a>
              </div>
              {String(ep.video_error ?? "").includes("ComfyUI") && (
                <p className="muted" style={{ fontSize: 12, marginTop: 14 }}>Start your local ComfyUI server (the one with <code>Z-image.json</code>, port 8188) and press Try again.</p>
              )}
            </div>
          ) : (
            <div className="card pad" style={{ textAlign: "center", padding: 50 }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>🎥</div>
              <div className="muted" style={{ marginBottom: 14 }}>
                {ep.audio_path
                  ? "Turn this episode into a narrated video: storyboard beats on the frontier model, frames from your local Z-Image-Turbo (ComfyUI :8188), ffmpeg stitch with captions + Ken Burns motion."
                  : "Synthesize the audio first — the video uses the narration as its master clock."}
              </div>
              {ep.audio_path && (
                <div style={{ display: "flex", gap: 10, justifyContent: "center", alignItems: "center" }}>
                  <select className="btn" style={{ background: "var(--bg-2)", padding: "10px 14px", fontSize: 14, borderRadius: 10 }} value={videoMode} onChange={(e) => setVideoMode(e.target.value as "local" | "article_images")}>
                    <option value="local">AI Generated Images (ComfyUI)</option>
                    <option value="article_images">Use Scraped Article Images</option>
                  </select>
                  <button className={`btn primary ${videoBusy ? "loading" : ""}`} onClick={renderVideo} disabled={videoBusy}>Render video</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === "review" && (
        <div style={{ maxWidth: 860 }}>
          {ep.evaluation ? (
            <div className="grid">
              {/* header card — publish confidence + decision chip */}
              <div className="card pad" style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 46, fontWeight: 800, color: (ep.evaluation.publish_confidence ?? ((ep.evaluation.overall ?? 0) / 100)) >= 0.72 ? "var(--good)" : (ep.evaluation.publish_confidence ?? 0) >= 0.55 ? "var(--warm)" : "var(--bad)" }}>
                    {ep.evaluation.publish_confidence
                      ? `${Math.round((ep.evaluation.publish_confidence as number) * 100)}%`
                      : ep.evaluation.overall}
                  </div>
                  <div className={`chip ${((ep.evaluation.publish_confidence ?? ((ep.evaluation.overall ?? 0) / 100)) >= 0.72) ? "good" : "warm"}`} style={{ marginTop: 4 }}>
                    {(ep.evaluation.decision ?? (ep.evaluation.verdict ?? "review")).replace(/_/g, " ")}
                  </div>
                </div>
                <div style={{ flex: 1, minWidth: 260 }}>
                  {Object.entries(ep.evaluation.scores ?? {}).map(([k, v]) => (
                    <div key={k} style={{ marginBottom: 9 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                        <span className="muted" style={{ textTransform: "capitalize" }}>{k}</span><span className="mono">{v}</span>
                      </div>
                      <div className="progress-track"><div className="progress-fill" style={{ width: `${v}%` }} /></div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="card pad"><div className="label" style={{ fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase", color: "var(--text-3)", fontWeight: 600, marginBottom: 8 }}>Editor's note / fact check</div><p style={{ margin: 0, lineHeight: 1.65 }}>{ep.evaluation.summary ?? ep.evaluation.fact_check_notes}</p></div>
              {(ep.evaluation.reasons?.length ?? ep.evaluation.strengths?.length ?? 0) > 0 && (
                <div className="grid c2">
                  <div className="card pad" style={{ borderLeft: "3px solid var(--good)" }}>
                    <div className="label" style={{ fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase", color: "var(--good)", fontWeight: 600, marginBottom: 8 }}>Strengths / verdict reasoning</div>
                    <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.75, fontSize: 13.5 }}>{(ep.evaluation.reasons ?? ep.evaluation.strengths ?? []).map((s, i) => <li key={i}>{s}</li>)}</ul>
                  </div>
                  <div className="card pad" style={{ borderLeft: "3px solid var(--warm)" }}>
                    <div className="label" style={{ fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase", color: "var(--warm)", fontWeight: 600, marginBottom: 8 }}>Improve</div>
                    <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.75, fontSize: 13.5, marginBottom: 16 }}>{(ep.evaluation.improvements ?? []).map((s, i) => <li key={i}>{s}</li>)}</ul>
                    <button className={`btn sm ${videoBusy ? "loading" : ""}`} onClick={regenerateWithCritique} disabled={videoBusy} style={{ width: "100%", justifyContent: "center" }}>
                      Regenerate script based on critique
                    </button>
                  </div>
                </div>
              )}
              <div className="card pad"><div className="label" style={{ fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase", color: "var(--text-3)", fontWeight: 600, marginBottom: 8 }}>Fact-check</div><p style={{ margin: 0, lineHeight: 1.65 }} className="muted">{ep.evaluation.fact_check_notes}</p></div>
            </div>
          ) : (
            <div className="card pad" style={{ textAlign: "center", padding: 50 }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>🧪</div>
              <div className="muted">The quality review runs automatically after synthesis.</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    ready: ["✓ ready", "good"], failed: ["✕ failed", "trend"], script_ready: ["script ready", "ai"],
    queued: ["queued", ""], analyzing: ["analyzing", "warm"], scripting: ["writing", "warm"], synthesizing: ["voicing", "warm"], evaluating: ["reviewing", "warm"],
  };
  const [label, cls] = map[status] ?? [status, ""];
  return <span className={`chip ${cls}`}>{label}</span>;
}

function LangPickerModal({ currentLang, onClose, onPick }: { currentLang: string; onClose: () => void; onPick: (lang: string) => void }) {
  const LANGUAGES = [
    { code: "en", native: "English", label: "English", cast: "Heart & Adam" },
    { code: "hi", native: "हिन्दी", label: "Hindi", cast: "Priya & Arjun" },
    { code: "es", native: "Español", label: "Spanish", cast: "Dora & Alex" },
    { code: "fr", native: "Français", label: "French", cast: "Siwis & Sylvie" },
    { code: "pt", native: "Português", label: "Portuguese", cast: "Dora & Alex" },
    { code: "zh", native: "中文", label: "Chinese", cast: "Xiaobei & Yunxi" },
  ];
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 700, marginBottom: 4 }}>🌐 Recreate in language</div>
        <div className="muted" style={{ fontSize: 13, marginBottom: 18 }}>A new episode will be generated natively in the selected language with matching Kokoro voices. Your current episode is preserved.</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          {LANGUAGES.map((l) => (
            <div
              key={l.code}
              onClick={() => onPick(l.code)}
              className="card pad"
              style={{
                cursor: l.code === currentLang ? "default" : "pointer",
                opacity: l.code === currentLang ? 0.4 : 1,
                borderColor: l.code === currentLang ? "var(--accent)" : "var(--line-soft)",
                background: l.code === currentLang ? "rgba(91,227,200,0.06)" : "var(--panel-2)",
                padding: "12px 10px",
                textAlign: "center",
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 17 }}>{l.native}</div>
              <div className="dim" style={{ fontSize: 11, marginTop: 2 }}>{l.cast}</div>
              {l.code === currentLang && <div style={{ fontSize: 10, color: "var(--accent)", marginTop: 4 }}>current</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

