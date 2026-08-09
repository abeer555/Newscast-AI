"use client";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, useStore, timeAgo, fmtDuration, useInterval } from "@/lib/store";
import AudioPlayer from "@/components/AudioPlayer";

interface Segment { index: number; speaker: string; voice: string; direction: string; text: string; }
interface Script { title: string; description: string; tags: string[]; hosts: { name: string; role: string; voice: string }[]; segments: Segment[]; estimated_seconds: number; }
interface Evaluation { scores: Record<string, number>; overall: number; verdict: string; strengths: string[]; improvements: string[]; fact_check_notes: string; summary: string; }
interface Episode {
  id: string; cluster_id: string; title: string; format: string; language: "en" | "ar"; status: string; progress: number; stage_label: string;
  error: string | null; script: Script | null; audio_path: string | null; audio_duration: number | null; evaluation: Evaluation | null;
  created_at: number; script_model: string | null; play_count: number;
}

const DIRECTIONS = ["", "cheerful", "warm", "casual", "serious", "thoughtful", "curious", "professionally", "authoritatively", "excited", "urgent", "somber", "deadpan", "whisper"];

export default function StudioPage() {
  const { id } = useParams<{ id: string }>();
  const { pushToast, episodeProgress } = useStore((s) => ({ pushToast: s.pushToast, episodeProgress: s.episodeProgress }));
  const [ep, setEp] = useState<Episode | null>(null);
  const [draft, setDraft] = useState<Script | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"script" | "listen" | "review">("script");

  const load = async () => {
    const j = await api<Episode>(`/api/episodes/${id}`);
    setEp(j);
    if (j.script && !dirty) setDraft(j.script);
    if (j.status === "ready" && j.audio_path) setTab((t) => (t === "script" && !dirty ? "listen" : t));
  };
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [id]);
  const live = episodeProgress[id];
  const running = ep && !["ready", "failed", "script_ready", "draft"].includes(ep.status);
  useInterval(() => { if (running) void load(); }, running ? 2500 : null);

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
            <span className="chip">{ep.language === "ar" ? "العربية" : "English"}</span>
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
        <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>
          {dirty && <button className={`btn ${busy ? "loading spin-light" : ""}`} onClick={() => save(true)} disabled={busy}>Save script</button>}
          {(ep.status === "script_ready" || (ep.status === "failed" && draft)) && (
            <button className={`btn primary ${busy ? "loading" : ""}`} onClick={synthesize} disabled={busy}>
              {ep.audio_path ? "Re-synthesize audio" : "Synthesize audio"}
            </button>
          )}
          {ep.status === "ready" && <span className="chip good" style={{ alignSelf: "center", padding: "8px 14px", fontSize: 13 }}>✓ On air</span>}
        </div>
      </div>

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
                {termsIssue ? (
                  <>
                    <b style={{ color: "var(--bad)" }}>Voice model needs a one-time opt-in.</b>
                    <div className="muted" style={{ marginTop: 6, lineHeight: 1.6 }}>
                      Groq requires org-admin acceptance of the Orpheus TTS terms (free). Visit{" "}
                      <a href="https://console.groq.com/playground?model=canopylabs%2Forpheus-v1-english" target="_blank" rel="noreferrer" style={{ color: "var(--accent-2)", textDecoration: "underline" }}>
                        console.groq.com/playground
                      </a>{" "}
                      with model <span className="mono">orpheus-v1-english</span> selected, accept the terms, then press <b>Synthesize audio</b>. Your script is saved.
                    </div>
                  </>
                ) : (
                  <span className="mono" style={{ color: "var(--bad)" }}>{ep.error}</span>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        {(["script", "listen", "review"] as const).map((t) => (
          <button key={t} className="btn sm" onClick={() => setTab(t)}
            style={{ background: tab === t ? "var(--panel-3)" : "var(--panel)", color: tab === t ? "var(--accent)" : "var(--text-2)" }}>
            {t === "script" ? `Script${draft ? ` (${draft.segments.length})` : ""}` : t === "listen" ? "Listen" : "Quality review"}
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
              <AudioPlayer src={ep.audio_path} segments={draft?.segments} duration={ep.audio_duration} episodeId={ep.id} />
              {draft && (
                <div className="card pad" style={{ marginTop: 14 }}>
                  <div className="label" style={{ fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase", color: "var(--text-3)", fontWeight: 600, marginBottom: 10 }}>Transcript</div>
                  <div style={{ display: "grid", gap: 8, maxHeight: 320, overflow: "auto" }}>
                    {draft.segments.map((s, i) => (
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

      {tab === "review" && (
        <div style={{ maxWidth: 860 }}>
          {ep.evaluation ? (
            <div className="grid">
              <div className="card pad" style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 46, fontWeight: 800, color: ep.evaluation.overall >= 80 ? "var(--good)" : ep.evaluation.overall >= 65 ? "var(--warm)" : "var(--bad)" }}>
                    {ep.evaluation.overall}
                  </div>
                  <div className="chip good" style={{ marginTop: 4 }}>{ep.evaluation.verdict.replace("_", " ")}</div>
                </div>
                <div style={{ flex: 1, minWidth: 260 }}>
                  {Object.entries(ep.evaluation.scores).map(([k, v]) => (
                    <div key={k} style={{ marginBottom: 9 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                        <span className="muted" style={{ textTransform: "capitalize" }}>{k}</span><span className="mono">{v}</span>
                      </div>
                      <div className="progress-track"><div className="progress-fill" style={{ width: `${v}%` }} /></div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="card pad"><div className="label" style={{ fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase", color: "var(--text-3)", fontWeight: 600, marginBottom: 8 }}>Editor's note</div><p style={{ margin: 0, lineHeight: 1.65 }}>{ep.evaluation.summary}</p></div>
              <div className="grid c2">
                <div className="card pad" style={{ borderLeft: "3px solid var(--good)" }}>
                  <div className="label" style={{ fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase", color: "var(--good)", fontWeight: 600, marginBottom: 8 }}>Strengths</div>
                  <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.75, fontSize: 13.5 }}>{ep.evaluation.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
                </div>
                <div className="card pad" style={{ borderLeft: "3px solid var(--warm)" }}>
                  <div className="label" style={{ fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase", color: "var(--warm)", fontWeight: 600, marginBottom: 8 }}>Improve</div>
                  <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.75, fontSize: 13.5 }}>{ep.evaluation.improvements.map((s, i) => <li key={i}>{s}</li>)}</ul>
                </div>
              </div>
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
