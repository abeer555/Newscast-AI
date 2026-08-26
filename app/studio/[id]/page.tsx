"use client";

/**
 * The studio: what the episode says, what backs it, and whether it may be published.
 *
 * Four surfaces over one spine. The publish gate sits above everything because it is
 * the only question that matters before an episode goes out, and it is answerable:
 * the score is a sum of nine checks, each of which states what it measured, the rule
 * it applied, how many points that earned, what to do about it and which tab to do it
 * on. "Why 61%?" is a list, not a mood.
 *
 * Underneath, the same evidence runs through every tab. A claim in the dossier points
 * at the script lines that carry it, at the audio timestamp where it is spoken and at
 * the video beats on screen while it is — and each of those points back. So the Script
 * tab can say which lines nothing supports, playback can name the sources behind the
 * sentence you are hearing, and a beat can say whether its frame is a photograph from
 * the coverage or an illustration a model drew.
 *
 * Where a number is estimated rather than measured, it says so.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, useStore, fmtDuration, useInterval } from "@/lib/store";
import AudioPlayer from "@/components/AudioPlayer";
import { Explain } from "@/components/Explain";
import { Panel, TierBadge } from "@/components/Evidence";
import { Time, clock } from "@/components/Time";
import type {
  BackingLevel,
  BeatLink,
  ClaimLink,
  EpisodeGate,
  EpisodeMedia,
  GateCheck,
  SegmentBacking,
  StudioTab,
} from "@/lib/gates";

/** Mirrors PUBLISH_THRESHOLD in lib/gates.ts, which cannot be value-imported here
 *  because that module reaches the database. The gate's own text is authoritative;
 *  this is only used to draw the threshold on the bar. */
const PUBLISH_AT = 72;

interface Segment { index: number; speaker: string; voice: string; direction: string; text: string; }
interface Script { title: string; description: string; tags: string[]; hosts: { name: string; role: string; voice: string }[]; segments: Segment[]; estimated_seconds: number; }
interface Episode {
  id: string; cluster_id: string; title: string; format: string; language: "en" | "ar"; status: string; progress: number; stage_label: string;
  error: string | null; script: Script | null; audio_path: string | null; audio_duration: number | null;
  created_at: number; updated_at: number; script_model: string | null; play_count: number;
  video_status: string | null; video_path: string | null; video_duration: number | null; video_error: string | null; video_mode?: "local" | "article_images";
  storyboard: { beats: { index: number; image_prompt: string; caption: string; duration: number }[]; total_duration: number } | null;
}

const DIRECTIONS = ["", "cheerful", "warm", "casual", "serious", "thoughtful", "curious", "professionally", "authoritatively", "excited", "urgent", "somber", "deadpan", "whisper"];

const STAGES = ["Analyze", "Write script", "Review script", "Synthesize", "Publish gate"];

export default function StudioPage() {
  const { id } = useParams<{ id: string }>();
  const { pushToast, episodeProgress } = useStore((s) => ({ pushToast: s.pushToast, episodeProgress: s.episodeProgress }));
  const [ep, setEp] = useState<Episode | null>(null);
  const [draft, setDraft] = useState<Script | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<StudioTab>("script");
  const [videoBusy, setVideoBusy] = useState(false);
  const [videoMode, setVideoMode] = useState<"local" | "article_images">("local");
  const [showLangPicker, setShowLangPicker] = useState(false);

  /* the gate and the media chain */
  const [gate, setGate] = useState<EpisodeGate | null>(null);
  const [media, setMedia] = useState<EpisodeMedia | null>(null);
  const [checksOpen, setChecksOpen] = useState(false);
  const [gateBusy, setGateBusy] = useState(false);

  /* playback */
  const [activeSeg, setActiveSeg] = useState(-1);
  const [seekReq, setSeekReq] = useState<{ t: number; nonce: number } | null>(null);
  const nonce = useRef(0);

  /* cross-highlighting between claims, lines and beats */
  const [focusClaim, setFocusClaim] = useState<string | null>(null);
  const [focusSeg, setFocusSeg] = useState<number | null>(null);

  /* per-line rewrite */
  const [regenIdx, setRegenIdx] = useState<number | null>(null);
  const [regenInstruction, setRegenInstruction] = useState("");
  const [regenBusy, setRegenBusy] = useState(false);
  const [regenNote, setRegenNote] = useState<{ index: number; previous: string; rationale: string } | null>(null);

  /* publish / override */
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideNote, setOverrideNote] = useState("");

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

  const loadGate = async () => {
    try {
      const j = await api<{ gate: EpisodeGate; media: EpisodeMedia | null }>(`/api/episodes/${id}/gate`);
      setGate(j.gate);
      setMedia(j.media);
    } catch {
      // A script-less episode has no gate yet; the banner simply stays hidden.
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  const live = episodeProgress[id];
  // needs_review is a resting state, not a stage in flight — polling through it forever
  // hammered the API and kept the spinner up on an episode that was waiting for a human.
  const running = !!ep && !["ready", "failed", "script_ready", "draft", "needs_review"].includes(ep.status);
  useInterval(() => { if (running) void load(); }, running ? 1000 : null);
  const videoRunning = !!ep && (ep.video_status === "queued" || ep.video_status === "storyboard" || ep.video_status === "rendering");
  useInterval(() => { if (videoRunning) void load(); }, videoRunning ? 3000 : null);

  // Recompute the gate whenever the episode settles on a new revision. Skipped while
  // the pipeline runs, because a half-written episode fails checks that are about to pass.
  const gateStamp = useRef(-1);
  useEffect(() => {
    if (!ep?.script || running) return;
    const stamp = ep.updated_at ?? 0;
    if (gateStamp.current === stamp) return;
    gateStamp.current = stamp;
    void loadGate();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [ep?.updated_at, ep?.script, running]);

  const backingByIndex = useMemo(() => {
    const m = new Map<number, SegmentBacking>();
    for (const b of media?.backing ?? []) m.set(b.index, b);
    return m;
  }, [media]);

  const timingByIndex = useMemo(() => {
    const m = new Map<number, { start: number; end: number }>();
    for (const t of media?.timings ?? []) m.set(t.index, t);
    return m;
  }, [media]);

  const focusedClaim = useMemo(
    () => (focusClaim ? (media?.claims ?? []).find((c) => c.id === focusClaim) ?? null : null),
    [focusClaim, media],
  );
  const focusedSegs = useMemo(() => new Set(focusedClaim?.segments ?? []), [focusedClaim]);
  const focusedBeats = useMemo(() => new Set(focusedClaim?.beats ?? []), [focusedClaim]);

  const seekTo = (t: number) => {
    nonce.current += 1;
    setSeekReq({ t, nonce: nonce.current });
    setTab("listen");
  };

  const goToCheck = (c: GateCheck) => {
    if (!c.target) return;
    setTab(c.target.tab);
    if (c.target.segment !== undefined) setFocusSeg(c.target.segment);
  };

  // Scroll the targeted line into view once its tab has painted.
  useEffect(() => {
    if (focusSeg === null || tab !== "script") return;
    const el = document.getElementById(`seg-${focusSeg}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    const clear = setTimeout(() => setFocusSeg(null), 4000);
    return () => clearTimeout(clear);
  }, [focusSeg, tab]);

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
    const improvements = gate?.advisory?.improvements ?? [];
    if (!improvements.length) return;
    setBusy(true);
    try {
      await api(`/api/episodes/${id}/regenerate`, { method: "POST", body: JSON.stringify({ critique: improvements }) });
      pushToast("Regenerating the script against the critique…", "good");
      setDirty(false);
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
      pushToast("Recreating episode in new language…", "good");
      window.location.href = `/studio/${newId}`;
    } catch (e) { pushToast(String(e), "bad"); }
  };

  const stageIndex = useMemo(() => {
    const s = ep?.status ?? "queued";
    if (["queued", "analyzing"].includes(s)) return 0;
    if (s === "scripting") return 1;
    if (s === "script_ready") return 2;
    if (s === "synthesizing") return 3;
    if (s === "evaluating") return 4;
    if (s === "ready" || s === "needs_review") return 5;
    return 0;
  }, [ep?.status]);

  const save = async (invalidate: boolean) => {
    if (!draft) return;
    setBusy(true);
    try {
      await api(`/api/episodes/${id}`, { method: "PATCH", body: JSON.stringify({ title: draft.title, script: draft, invalidateAudio: invalidate }) });
      setDirty(false);
      pushToast(invalidate ? "Script saved — audio needs re-synthesis" : "Script saved", "good");
      await load();
      await loadGate();
    } catch (e) {
      pushToast(String(e), "bad");
    } finally {
      setBusy(false);
    }
  };

  const synthesize = async () => {
    setBusy(true);
    try {
      if (dirty && draft) {
        await api(`/api/episodes/${id}`, { method: "PATCH", body: JSON.stringify({ title: draft.title, script: draft, invalidateAudio: true }) });
        setDirty(false);
      }
      await api(`/api/episodes/${id}/synthesize`, { method: "POST" });
      pushToast("Synthesis started — unchanged lines are reused from the voice cache", "good");
      await load();
    } catch (e) { pushToast(`${e}`, "bad"); }
    setBusy(false);
  };

  const rewriteLine = async (i: number) => {
    setRegenBusy(true);
    try {
      const r = await api<{ index: number; previous: string; text: string; rationale: string; gate: EpisodeGate | null }>(
        `/api/episodes/${id}/segment`,
        { method: "POST", body: JSON.stringify({ index: i, instruction: regenInstruction.trim() || undefined }) },
      );
      setRegenNote({ index: r.index, previous: r.previous, rationale: r.rationale });
      setRegenIdx(null);
      setRegenInstruction("");
      pushToast(`Line ${i + 1} rewritten — re-synthesize to hear it`, "good");
      await load();
      await loadGate();
    } catch (e) {
      pushToast(String(e), "bad");
    } finally {
      setRegenBusy(false);
    }
  };

  const recheck = async () => {
    setGateBusy(true);
    try {
      const j = await api<{ gate: EpisodeGate; media: EpisodeMedia | null }>(`/api/episodes/${id}/gate`, { method: "POST", body: JSON.stringify({}) });
      setGate(j.gate);
      setMedia(j.media);
      pushToast(`Re-checked — ${j.gate.headline.toLowerCase()}`, j.gate.verdict === "publish" ? "good" : "bad");
    } catch (e) {
      pushToast(String(e), "bad");
    } finally {
      setGateBusy(false);
    }
  };

  const publish = async (note: string | null) => {
    setGateBusy(true);
    try {
      const j = await api<{ gate: EpisodeGate; media: EpisodeMedia | null; overridden?: boolean }>(
        `/api/episodes/${id}/gate`,
        { method: "POST", body: JSON.stringify({ approve: true, note: note ?? "" }) },
      );
      setGate(j.gate);
      setMedia(j.media);
      setOverrideOpen(false);
      setOverrideNote("");
      pushToast(j.overridden ? "Published — the override and its reason are on the record" : "Published", "good");
      await load();
    } catch (e) {
      pushToast(String(e), "bad");
    } finally {
      setGateBusy(false);
    }
  };

  if (!ep) return <div style={{ padding: 40 }}><div className="skeleton" style={{ height: 320 }} /></div>;
  const progressPct = Math.round(((live?.progress ?? ep.progress) || 0) * 100);
  const stageLabel = live?.stageLabel ?? ep.stage_label ?? "";
  const held = gate?.verdict === "needs_review";

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
          <div className="page-sub">
            Created <Time at={ep.created_at} />
            {ep.audio_duration ? ` · ${fmtDuration(ep.audio_duration)}` : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, flexShrink: 0, alignItems: "center" }}>
          {dirty && <button className={`btn ${busy ? "loading spin-light" : ""}`} onClick={() => save(true)} disabled={busy}>Save script</button>}
          {(ep.status === "script_ready" || ep.status === "needs_review" || (ep.status === "failed" && draft)) && (
            <button className={`btn primary ${busy ? "loading" : ""}`} onClick={synthesize} disabled={busy}>
              {ep.audio_path ? "Re-synthesize audio" : "Synthesize audio"}
            </button>
          )}
          <button className="btn sm" onClick={() => setShowLangPicker(true)} title="Recreate in a different language" style={{ gap: 6 }}>🌐 Language</button>
          {ep.status === "ready" && <span className="chip good" style={{ alignSelf: "center", padding: "8px 14px", fontSize: 13 }}>✓ On air</span>}
        </div>
      </div>
      {showLangPicker && <LangPickerModal currentLang={ep.language} onClose={() => setShowLangPicker(false)} onPick={recreateInLanguage} />}

      {gate && (
        <GateBanner
          gate={gate}
          open={checksOpen}
          onToggle={() => setChecksOpen((v) => !v)}
          onGoFix={goToCheck}
          onReview={() => setTab("review")}
        />
      )}

      {/* pipeline stages */}
      <div className="card pad" style={{ marginBottom: 20 }}>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${STAGES.length}, 1fr)`, gap: 8 }}>
          {STAGES.map((s, i) => {
            const done = stageIndex > i;
            const current = stageIndex === i && (running || ep.status === "script_ready");
            return (
              <div key={s} style={{ textAlign: "center" }}>
                <div style={{ height: 4, borderRadius: 99, background: done ? "var(--accent)" : current ? "linear-gradient(90deg,var(--accent),var(--accent-2))" : "var(--panel-3)", marginBottom: 8, transition: "all 0.4s" }} />
                <div style={{ fontSize: 12, color: done || current ? "var(--text)" : "var(--text-3)" }}>{s}</div>
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
                  <div style={{ color: "var(--bad)", fontWeight: 600, marginBottom: 8 }}>Pipeline error: {ep.error}</div>
                  <div className="dim">It failed at the <b>{(ep.stage_label ?? "").toLowerCase()}</b> stage. You can retry synthesis or run the pipeline again.</div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="tabs">
        {(["script", "listen", "watch", "review"] as StudioTab[]).map((t) => (
          <button key={t} className="btn sm" onClick={() => setTab(t)}
            style={{ background: tab === t ? "var(--panel-3)" : "var(--panel)", color: tab === t ? "var(--accent)" : "var(--text-2)" }}>
            {t === "script"
              ? `Script${draft ? ` (${draft.segments.length})` : ""}`
              : t === "listen"
                ? "Listen"
                : t === "watch"
                  ? "Watch"
                  : `Review${gate?.blocking.length ? ` (${gate.blocking.length})` : ""}`}
          </button>
        ))}
      </div>

      {/* ---------------------------------------------------------------- script */}
      {tab === "script" && draft && (
        <div className="grid" style={{ gap: 12 }}>
          <div className="card pad" style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            {draft.hosts.map((h) => (
              <span key={h.name} className="chip ai">🎙 {h.name} <span className="dim">· {h.role} · {h.voice}</span></span>
            ))}
            <span className="chip">tags: {draft.tags.join(", ")}</span>
            <span className="chip warm">~{fmtDuration(draft.estimated_seconds)} spoken</span>
            {media && (
              <span className="chip">
                {media.coverage_pct}% of lines traced to a claim
                <Explain title="What “traced” means" label="?" width={350}>
                  <p className="ex-p">{media.method}</p>
                  <p className="ex-p dim">
                    <Link className="ex-link" href="/methodology#tiers">How claim tiers are assigned</Link>
                  </p>
                </Explain>
              </span>
            )}
          </div>

          {dirty && (
            <div className="card pad est-note">
              <span aria-hidden>✎</span>
              <span>You have unsaved edits. The evidence chips below describe the <b>last saved</b> script, and per-line rewriting is paused until you save.</span>
            </div>
          )}

          {regenNote && (
            <div className="card pad" style={{ borderLeft: "3px solid var(--accent)" }}>
              <div className="section-label accent">Line {regenNote.index + 1} rewritten</div>
              <p className="muted" style={{ margin: "0 0 8px", fontSize: 13.5, lineHeight: 1.6 }}>{regenNote.rationale}</p>
              <p className="dim" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6 }}>Was: “{regenNote.previous}”</p>
              <button className="btn sm" style={{ marginTop: 10 }} onClick={() => setRegenNote(null)}>Dismiss</button>
            </div>
          )}

          {draft.segments.map((seg, i) => {
            const back = backingByIndex.get(i);
            const isFocus = focusSeg === i || focusedSegs.has(i);
            return (
              <div
                key={i}
                id={`seg-${i}`}
                className="card pad"
                style={{ borderColor: isFocus ? "var(--accent)" : undefined, background: isFocus ? "rgba(91,227,200,0.05)" : undefined }}
              >
                <div className="seg-card">
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
                  <div className="seg-meta" style={{ paddingTop: 8 }}>
                    line {i + 1} · voice {seg.voice}<br />
                    {seg.text.trim().split(/\s+/).filter(Boolean).length} words / {seg.text.length} chars
                    <div className="progress-track" style={{ height: 4, marginTop: 6 }}>
                      <div style={{ height: "100%", width: `${Math.min(100, (seg.text.length / 200) * 100)}%`, background: seg.text.length > 190 ? "var(--bad)" : seg.text.length > 150 ? "var(--warm)" : "var(--good)", borderRadius: 99 }} />
                    </div>
                    {timingByIndex.get(i) && (
                      <div style={{ marginTop: 6 }}>{clock(timingByIndex.get(i)!.start)}–{clock(timingByIndex.get(i)!.end)}</div>
                    )}
                  </div>
                  <div>
                    <textarea
                      className="seg-text"
                      value={seg.text}
                      rows={2}
                      onChange={(e) => { const segs = [...draft.segments]; segs[i] = { ...seg, text: e.target.value }; setDraft({ ...draft, segments: segs }); setDirty(true); }}
                    />
                    <div className="seg-foot">
                      {back ? <BackingChip backing={back} /> : <span className="chip conf-none">Not yet checked against the evidence layer</span>}
                      {media && media.timings.length > 0 && (
                        <button className="btn sm ghost" onClick={() => seekTo(timingByIndex.get(i)?.start ?? 0)} disabled={!ep.audio_path}>▶ Hear it</button>
                      )}
                      <button
                        className="btn sm"
                        onClick={() => { setRegenIdx(regenIdx === i ? null : i); setRegenInstruction(""); }}
                        disabled={dirty || regenBusy}
                        title={dirty ? "Save your edits first — the rewrite works from the saved script" : "Rewrite this line against the verified claims"}
                      >
                        {regenIdx === i ? "Cancel" : "Rewrite this line"}
                      </button>
                    </div>
                    {regenIdx === i && (
                      <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <input
                          className="input"
                          style={{ flex: 1, minWidth: 240 }}
                          placeholder="Optional: what should change? (default: tighten it and make the sourcing honest)"
                          value={regenInstruction}
                          onChange={(e) => setRegenInstruction(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter" && !regenBusy) void rewriteLine(i); }}
                        />
                        <button className={`btn primary sm ${regenBusy ? "loading" : ""}`} onClick={() => void rewriteLine(i)} disabled={regenBusy}>Rewrite</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === "script" && !draft && (
        <div className="card pad empty">No script yet — it arrives at the end of the writing stage.</div>
      )}

      {/* ---------------------------------------------------------------- listen */}
      {tab === "listen" && (
        <div style={{ maxWidth: 880 }}>
          {ep.audio_path ? (
            <>
              <AudioPlayer
                src={`${ep.audio_path}?v=${ep.updated_at ?? ep.created_at ?? Date.now()}`}
                segments={ep.script?.segments}
                duration={ep.audio_duration}
                episodeId={ep.id}
                timings={media?.timings ?? null}
                onActive={setActiveSeg}
                seekRequest={seekReq}
                activeSlot={media ? (i) => <NowSpeaking backing={backingByIndex.get(i)} /> : undefined}
              />

              {media && !media.timing_measured && (
                <div className="card pad est-note" style={{ marginTop: 12 }}>
                  <span aria-hidden>⚠</span>
                  <span>
                    Line positions are <b>estimated</b>, not measured — the highlight is approximate.
                    <Explain title="Why the timing is approximate" label="Why?" width={360}>
                      <p className="ex-p">{media.timing_method}</p>
                      <p className="ex-p">Re-synthesizing fixes this: synthesis now measures the duration of every utterance as it writes it, and unchanged lines come from the voice cache, so it is fast.</p>
                    </Explain>
                  </span>
                </div>
              )}

              {media && (
                <div className="card pad" style={{ marginTop: 14 }}>
                  <div className="section-label">
                    Transcript
                    <span className="n">click a line to hear it · {media.coverage_pct}% traced to a verified claim</span>
                    <Explain title="What the chips mean" label="?" width={360}>
                      <p className="ex-p">Each line carries the strongest tier among the claims that back it, the number of outlets carrying them and the number of <i>independent</i> reporting chains behind them.</p>
                      <p className="ex-p">A line with no chip is not necessarily wrong — it may be narration or a transition. It means nothing in the evidence layer supports it as a factual assertion.</p>
                      <p className="ex-p dim">{media.method}</p>
                    </Explain>
                  </div>
                  <div className="tx" style={{ maxHeight: 460, overflow: "auto" }}>
                    {media.backing.map((b) => {
                      const t = timingByIndex.get(b.index);
                      return (
                        <div
                          key={b.index}
                          className={`tx-line ${activeSeg === b.index ? "active" : ""} ${b.claim_ids.length ? "" : "unbacked"}`}
                          style={focusedSegs.has(b.index) ? { borderColor: "var(--accent-2)" } : undefined}
                        >
                          <span className="tx-stamp">{clock(t?.start ?? 0)}</span>
                          <span>
                            <button className="tx-hit" onClick={() => seekTo(t?.start ?? 0)}>
                              <span className="tx-speaker">{b.speaker}</span>
                              <span style={{ display: "block", marginTop: 2 }}>{b.text}</span>
                            </button>
                            <span className="tx-ev">
                              <BackingChip backing={b} />
                              {b.tier && (
                                <TierBadge
                                  tier={b.tier}
                                  compact
                                  outlets={b.outlets}
                                  reason={`${b.claim_ids.length} verified ${b.claim_ids.length === 1 ? "claim" : "claims"} match this line; the strongest rests on ${b.independent} independent reporting ${b.independent === 1 ? "chain" : "chains"}.`}
                                />
                              )}
                            </span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {media && media.claims.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <Panel
                    title="What this episode asserts"
                    sub={`${media.spoken_claim_count} of ${media.total_claim_count} verified claims are spoken aloud. Each one points at the moment you hear it and the beats on screen while you do.`}
                  >
                    {media.claims.filter((c) => c.segments.length).map((c) => (
                      <ClaimRow
                        key={c.id}
                        claim={c}
                        active={focusClaim === c.id}
                        onFocus={() => setFocusClaim(focusClaim === c.id ? null : c.id)}
                        onHear={(t) => { setFocusClaim(c.id); seekTo(t); }}
                        onWatch={() => { setFocusClaim(c.id); setTab("watch"); }}
                      />
                    ))}
                  </Panel>
                </div>
              )}

              {media && media.claims.some((c) => !c.segments.length) && (
                <div style={{ marginTop: 14 }}>
                  <Panel
                    tone="warm"
                    title="Verified claims the episode never mentions"
                    sub="These are in the dossier but absent from the narration — a coverage gap in the episode, not in the reporting."
                  >
                    {media.claims.filter((c) => !c.segments.length).slice(0, 10).map((c) => (
                      <div key={c.id} className="claim">
                        <div className="claim-text">{c.claim}</div>
                        <div className="claim-meta">
                          <TierBadge tier={c.tier} compact outlets={c.outlets} />
                          <span>{c.outlets.length} {c.outlets.length === 1 ? "outlet" : "outlets"} · {c.independent_count} independent {c.independent_count === 1 ? "chain" : "chains"}</span>
                        </div>
                      </div>
                    ))}
                  </Panel>
                </div>
              )}
            </>
          ) : (
            <div className="card pad" style={{ textAlign: "center", padding: 50 }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>🎧</div>
              <div className="muted">No audio yet — synthesize it from the Script tab.</div>
            </div>
          )}
        </div>
      )}

      {/* ---------------------------------------------------------------- watch */}
      {tab === "watch" && (
        <div style={{ maxWidth: 900 }}>
          {ep.video_path ? (
            <>
              <div className="card pad" style={{ padding: 8, background: "black" }}>
                <video key={ep.video_path} controls playsInline preload="metadata" style={{ width: "100%", borderRadius: 10, display: "block" }} src={`${ep.video_path}?v=${ep.updated_at}`} />
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, fontSize: 13, flexWrap: "wrap" }} className="muted">
                <span className="chip good">✓ video ready</span>
                {ep.video_duration ? <span>{fmtDuration(ep.video_duration)}</span> : null}
                {media && media.beats.length > 0 && <ProvenanceSummary beats={media.beats} />}
                <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  <select className="btn sm" style={{ background: "var(--bg-2)" }} value={videoMode} onChange={(e) => setVideoMode(e.target.value as "local" | "article_images")}>
                    <option value="local">🎨 AI-generated imagery (ComfyUI)</option>
                    <option value="article_images">📰 Source photography only</option>
                  </select>
                  <button className={`btn sm ${videoBusy ? "loading" : ""}`} onClick={renderVideo} disabled={videoBusy}>Re-render</button>
                </div>
              </div>

              {media && media.beats.length > 0 ? (
                <div className="card pad" style={{ marginTop: 14 }}>
                  <div className="section-label">
                    Storyboard
                    <span className="n">every frame declares what it is</span>
                    <Explain title="Why frames are labelled" label="?" width={350}>
                      <p className="ex-p">A generated illustration that looks like news footage is the fastest way to mislead someone. Every beat states whether its frame is a photograph published with the coverage or an image a model drew for this beat.</p>
                      <p className="ex-p">Beats also carry their on-screen window and the script lines they cover, so a frame can be traced to the sentence it illustrates.</p>
                    </Explain>
                  </div>
                  <div className="beats">
                    {media.beats.map((b) => (
                      <BeatCard
                        key={b.index}
                        beat={b}
                        active={focusedBeats.has(b.index) || (activeSeg >= b.segment_range[0] && activeSeg <= b.segment_range[1])}
                        onPlay={() => seekTo(b.start)}
                      />
                    ))}
                  </div>
                </div>
              ) : ep.storyboard ? (
                <div className="card pad empty" style={{ marginTop: 14 }}>
                  This video was rendered before provenance was recorded, so its frames cannot be labelled. Re-render to label them.
                </div>
              ) : null}
            </>
          ) : videoRunning ? (
            <div className="card pad" style={{ textAlign: "center", padding: 50 }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>🎬</div>
              <div className="muted" style={{ marginBottom: 12 }}>
                {ep.video_status === "queued" ? "Queued — worker starting…" : ep.video_status === "storyboard" ? "Designing the storyboard…" : "Rendering frames and stitching with ffmpeg…"}
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
                  <option value="local">AI-generated imagery (ComfyUI)</option>
                  <option value="article_images">Source photography only</option>
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
                  ? "Turn this episode into a narrated video. The narration is the master clock; every frame is labelled as source photography or a generated illustration."
                  : "Synthesize the audio first — the video uses the narration as its master clock."}
              </div>
              {ep.audio_path && (
                <div style={{ display: "flex", gap: 10, justifyContent: "center", alignItems: "center", flexWrap: "wrap" }}>
                  <select className="btn" style={{ background: "var(--bg-2)", padding: "10px 14px", fontSize: 14, borderRadius: 10 }} value={videoMode} onChange={(e) => setVideoMode(e.target.value as "local" | "article_images")}>
                    <option value="local">AI-generated imagery (ComfyUI)</option>
                    <option value="article_images">Source photography from the coverage</option>
                  </select>
                  <button className={`btn primary ${videoBusy ? "loading" : ""}`} onClick={renderVideo} disabled={videoBusy}>Render video</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ---------------------------------------------------------------- review */}
      {tab === "review" && (
        <div style={{ maxWidth: 900 }} className="grid">
          {gate ? (
            <>
              <Panel
                title={`Publish gate — ${gate.score}/100`}
                sub={gate.summary}
                right={<button className={`btn sm ${gateBusy ? "loading" : ""}`} onClick={recheck} disabled={gateBusy}>Re-check</button>}
                tone={gate.verdict === "publish" ? "good" : gate.blocking.length ? "bad" : "warm"}
              >
                <div style={{ marginTop: 4 }}>
                  {gate.checks.map((c) => <CheckRow key={c.id} check={c} onGoFix={goToCheck} />)}
                </div>
                <p className="dim" style={{ fontSize: 12, lineHeight: 1.65, marginTop: 14, marginBottom: 0 }}>{gate.method}</p>
              </Panel>

              <Panel
                title="Publish decision"
                sub={
                  gate.verdict === "publish"
                    ? "Every blocking check passed. Publishing records the score that cleared it."
                    : "Publishing from here is an override. It is recorded with your reason and shown on the episode afterwards."
                }
                tone={held ? "warm" : "good"}
              >
                {gate.override && (
                  <div className="est-note" style={{ marginBottom: 12 }}>
                    <span aria-hidden>⚑</span>
                    <span>Published by override on <Time at={gate.override.at} mode="exact" />{gate.override.note ? ` — “${gate.override.note}”` : ""}</span>
                  </div>
                )}
                {ep.status === "ready" ? (
                  <div className="row">
                    <span className="chip good">✓ On air</span>
                    <span className="dim" style={{ fontSize: 12.5 }}>Edit the script or re-check to move it back into review.</span>
                  </div>
                ) : gate.verdict === "publish" ? (
                  <button className={`btn primary ${gateBusy ? "loading" : ""}`} onClick={() => void publish(null)} disabled={gateBusy}>Publish this episode</button>
                ) : !overrideOpen ? (
                  <div className="row">
                    <button className="btn" onClick={() => setOverrideOpen(true)}>Publish anyway…</button>
                    <span className="dim" style={{ fontSize: 12.5 }}>
                      {gate.blocking.length
                        ? `${gate.blocking.length} ${gate.blocking.length === 1 ? "check fails" : "checks fail"} outright.`
                        : `The score is ${gate.score}, under the ${PUBLISH_AT} needed.`}
                    </span>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <input
                      className="input"
                      style={{ flex: 1, minWidth: 280 }}
                      placeholder="Why is this safe to publish despite the failing checks?"
                      value={overrideNote}
                      onChange={(e) => setOverrideNote(e.target.value)}
                    />
                    <button className={`btn primary ${gateBusy ? "loading" : ""}`} onClick={() => void publish(overrideNote.trim())} disabled={gateBusy || !overrideNote.trim()}>
                      Record override and publish
                    </button>
                    <button className="btn sm" onClick={() => { setOverrideOpen(false); setOverrideNote(""); }}>Cancel</button>
                  </div>
                )}
              </Panel>

              {gate.advisory ? (
                <Panel
                  title="Editorial critique from the model"
                  sub="Advisory only. This does not move the score above and cannot publish or hold an episode — it is one reader's opinion, recorded so you can weigh it."
                  tone="dim"
                >
                  {gate.advisory.publish_confidence !== null && (
                    <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
                      The model rated its own work {Math.round(gate.advisory.publish_confidence * 100)}%
                      {gate.advisory.decision ? ` and would ${gate.advisory.decision.replace(/_/g, " ")}` : ""}.
                      <Explain title="Why this is kept separate" label="?" width={340}>
                        <p className="ex-p">A model scoring its own episode cannot be audited, cannot be reproduced and has an obvious interest in liking the result. The gate above replaces it with fixed checks over stored data.</p>
                        <p className="ex-p">The critique is still useful for things arithmetic cannot see — a clumsy transition, a buried lede — so it is kept, labelled.</p>
                      </Explain>
                    </p>
                  )}
                  {gate.advisory.notes && <p className="prose" style={{ fontSize: 13.5 }}>{gate.advisory.notes}</p>}
                  {gate.advisory.reasons.length > 0 && (
                    <>
                      <div className="section-label" style={{ marginTop: 14 }}>Its reasoning</div>
                      <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.75, fontSize: 13.5 }} className="muted">
                        {gate.advisory.reasons.map((s, i) => <li key={i}>{s}</li>)}
                      </ul>
                    </>
                  )}
                  {gate.advisory.improvements.length > 0 && (
                    <>
                      <div className="section-label" style={{ marginTop: 16 }}>What it would change</div>
                      <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.75, fontSize: 13.5 }} className="muted">
                        {gate.advisory.improvements.map((s, i) => <li key={i}>{s}</li>)}
                      </ul>
                      <button className={`btn sm ${busy ? "loading" : ""}`} style={{ marginTop: 12 }} onClick={regenerateWithCritique} disabled={busy}>
                        Rewrite the whole script against this critique
                      </button>
                      <p className="dim" style={{ fontSize: 12, marginBottom: 0, marginTop: 8 }}>
                        For a single line, the Script tab rewrites just that one and keeps the rest of the audio.
                      </p>
                    </>
                  )}
                </Panel>
              ) : (
                <div className="card pad empty">The model has not critiqued this episode yet — that runs after synthesis.</div>
              )}
            </>
          ) : (
            <div className="card pad empty">
              The publish gate needs a script to check. It runs automatically as soon as one exists.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Gate
 * ------------------------------------------------------------------ */

function GateBanner({
  gate,
  open,
  onToggle,
  onGoFix,
  onReview,
}: {
  gate: EpisodeGate;
  open: boolean;
  onToggle: () => void;
  onGoFix: (c: GateCheck) => void;
  onReview: () => void;
}) {
  const pass = gate.verdict === "publish";
  const tone = pass ? "pass" : gate.blocking.length ? "bad" : "hold";
  const warns = gate.checks.filter((c) => c.status === "warn").length;
  return (
    <div className={`card pad gate ${pass ? "pass" : "block"}`} style={{ marginBottom: 18, display: "block" }}>
      <div className="gate-head">
        <div className={`gate-score ${tone}`}>
          <div className="n">{gate.score}</div>
          <div className="of">of 100</div>
          <div className="gate-bar" style={{ marginTop: 10, gridColumn: "auto" }}>
            <i style={{ width: `${Math.min(100, gate.score)}%`, background: pass ? "var(--good)" : gate.blocking.length ? "var(--bad)" : "var(--warm)" }} />
          </div>
        </div>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span className="gate-mark" aria-hidden>{pass ? "✅" : gate.blocking.length ? "⛔" : "⏳"}</span>
            <span className="gate-verdict">{gate.headline}</span>
            <Explain title={`Why ${gate.score} out of 100?`} label="Why this score?" width={390}>
              <p className="ex-p">{gate.method}</p>
              <p className="ex-p">
                <b>Publication needs two things:</b> a score of {PUBLISH_AT} or more, and no check failing outright. A high total cannot buy its way past a single blocking failure.
              </p>
              <p className="ex-p dim">Every check below states what it measured and what to do about it. Nothing here is a model&apos;s opinion.</p>
            </Explain>
          </div>
          <p className="gate-sum">{gate.summary}</p>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn sm" onClick={onToggle}>
              {open ? "Hide the nine checks" : `Show the nine checks${gate.blocking.length ? ` · ${gate.blocking.length} blocking` : ""}${warns ? ` · ${warns} ${warns === 1 ? "caveat" : "caveats"}` : ""}`}
            </button>
            {!pass && <button className="btn sm" onClick={onReview}>Go to review →</button>}
            {gate.override && <span className="chip warm">published by override</span>}
            <span className="dim" style={{ fontSize: 11.5 }}>checked <Time at={gate.computed_at} mode="relative" /></span>
          </div>
        </div>
      </div>
      {open && (
        <div style={{ marginTop: 16, borderTop: "1px solid var(--line-soft)", paddingTop: 6 }}>
          {gate.checks.map((c) => <CheckRow key={c.id} check={c} onGoFix={onGoFix} />)}
        </div>
      )}
    </div>
  );
}

const STATUS_MARK: Record<GateCheck["status"], { mark: string; colour: string; word: string }> = {
  pass: { mark: "✓", colour: "var(--good)", word: "passes" },
  warn: { mark: "!", colour: "var(--warm)", word: "needs attention" },
  fail: { mark: "✕", colour: "var(--bad)", word: "blocks publication" },
};

function CheckRow({ check, onGoFix }: { check: GateCheck; onGoFix: (c: GateCheck) => void }) {
  const s = STATUS_MARK[check.status];
  const share = check.weight > 0 ? (check.earned / check.weight) * 100 : 0;
  return (
    <div className={`gate-reason ${check.status === "fail" ? "fail" : ""}`}>
      <span style={{ color: s.colour, fontWeight: 700 }} title={s.word} aria-label={s.word}>{s.mark}</span>
      <span className="lbl">
        {check.label}
        <Explain title={check.label} label="?" width={360}>
          <p className="ex-p"><b>Measured:</b> {check.measured}</p>
          <p className="ex-p"><b>Rule:</b> {check.rule}</p>
          <p className="ex-p"><b>Contribution:</b> {fmtPts(check.earned)} of {check.weight} points — this check {s.word}.</p>
          {check.fix && <p className="ex-p"><b>To fix:</b> {check.fix}</p>}
        </Explain>
      </span>
      <span className="pts">{fmtPts(check.earned)}/{check.weight}</span>
      <span className="met">{check.measured}</span>
      <span className={`gate-bar ${check.status === "warn" ? "warn" : check.status === "fail" ? "fail" : ""}`}>
        <i style={{ width: `${Math.max(2, Math.min(100, share))}%` }} />
      </span>
      {check.fix && (
        <span className="fix">
          {check.fix}
          {check.target && (
            <button className="btn sm" style={{ marginLeft: 8, verticalAlign: "middle" }} onClick={() => onGoFix(check)}>
              Go fix{check.target.segment !== undefined ? ` line ${check.target.segment + 1}` : ` in ${check.target.tab}`} →
            </button>
          )}
        </span>
      )}
    </div>
  );
}

function fmtPts(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/* ------------------------------------------------------------------ *
 * Evidence-backed playback
 * ------------------------------------------------------------------ */

const CONF_CLASS: Record<BackingLevel, string> = {
  high: "conf-high",
  moderate: "conf-mod",
  low: "conf-low",
  none: "conf-none",
};

function BackingChip({ backing }: { backing: SegmentBacking }) {
  return (
    <span className={`chip ${CONF_CLASS[backing.level]}`}>
      {backing.label}
      <Explain title="What backs this line" label="?" width={380}>
        {backing.claim_ids.length ? (
          <>
            <p className="ex-p">
              {backing.sentence_coverage}% of this line&apos;s sentences match a verified claim, across{" "}
              <b>{backing.outlets.length}</b> {backing.outlets.length === 1 ? "outlet" : "outlets"} and{" "}
              <b>{backing.independent}</b> independent reporting {backing.independent === 1 ? "chain" : "chains"}.
            </p>
            {backing.citations.slice(0, 4).map((c) => (
              <p className="ex-p" key={c.claim_id}>
                <b>{c.tier}:</b> {c.claim}
                <span className="dim"> — {c.outlets.join(", ") || "outlet unresolved"} ({Math.round(c.match * 100)}% match)</span>
              </p>
            ))}
            {backing.outlets.length > 0 && (
              <p className="ex-p dim"><b>Outlets:</b> {backing.outlets.join(", ")}</p>
            )}
          </>
        ) : (
          <p className="ex-p">
            Nothing in the evidence layer supports this line as a factual assertion. That is expected for
            narration, framing and transitions — but if it states a fact, it should either be traceable to a
            claim or be cut.
          </p>
        )}
      </Explain>
    </span>
  );
}

function NowSpeaking({ backing }: { backing: SegmentBacking | undefined }) {
  if (!backing) {
    return <div className="empty" style={{ padding: "12px 14px" }}>Press play — the line being spoken appears here with the sources behind it.</div>;
  }
  return (
    <div style={{ padding: "13px 15px", background: "var(--bg-2)", borderRadius: 10, border: "1px solid var(--line-soft)" }}>
      <div className="row" style={{ gap: 8, marginBottom: 9 }}>
        <span className="chip ai">{backing.speaker}</span>
        <BackingChip backing={backing} />
        {backing.tier && <TierBadge tier={backing.tier} compact outlets={backing.outlets} />}
      </div>
      <div style={{ fontSize: 14.5, lineHeight: 1.6 }}>{backing.text}</div>
      {backing.outlets.length > 0 && (
        <div className="dim" style={{ fontSize: 11.5, marginTop: 9 }}>Reported by {backing.outlets.join(", ")}</div>
      )}
    </div>
  );
}

function ClaimRow({
  claim,
  active,
  onFocus,
  onHear,
  onWatch,
}: {
  claim: ClaimLink;
  active: boolean;
  onFocus: () => void;
  onHear: (t: number) => void;
  onWatch: () => void;
}) {
  const at = claim.first_at;
  return (
    <div className={`claim ${active ? "is-active" : ""}`}>
      <div className="claim-text">{claim.claim}</div>
      <div className="claim-meta">
        <TierBadge tier={claim.tier} compact outlets={claim.outlets} />
        <span>{claim.outlets.length} {claim.outlets.length === 1 ? "outlet" : "outlets"} · {claim.independent_count} independent {claim.independent_count === 1 ? "chain" : "chains"}</span>
        <button className="claim-cite" onClick={onFocus}>
          {active ? "clear" : `${claim.segments.length} ${claim.segments.length === 1 ? "line" : "lines"}`}
        </button>
        {at !== null && <button className="claim-cite" onClick={() => onHear(at)}>▶ heard at {clock(at)}</button>}
        {claim.beats.length > 0 && (
          <button className="claim-cite" onClick={onWatch}>
            🎞 {claim.beats.length === 1 ? `beat ${claim.beats[0] + 1}` : `${claim.beats.length} beats`}
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Visual provenance
 * ------------------------------------------------------------------ */

const PROV_TONE: Record<BeatLink["provenance"]["kind"], { cls: string; icon: string }> = {
  source_photo: { cls: "prov-good", icon: "📷" },
  ai_illustration: { cls: "prov-info", icon: "🎨" },
  unknown: { cls: "prov-dim", icon: "?" },
};

function ProvenanceSummary({ beats }: { beats: BeatLink[] }) {
  const photos = beats.filter((b) => b.provenance.kind === "source_photo").length;
  const ai = beats.filter((b) => b.provenance.kind === "ai_illustration").length;
  const unknown = beats.filter((b) => b.provenance.kind === "unknown").length;
  return (
    <span>
      {beats.length} beats ·{" "}
      {[photos ? `${photos} source photo${photos === 1 ? "" : "s"}` : null, ai ? `${ai} AI-generated` : null, unknown ? `${unknown} unlabelled` : null]
        .filter(Boolean)
        .join(" · ")}
    </span>
  );
}

function BeatCard({ beat, active, onPlay }: { beat: BeatLink; active: boolean; onPlay: () => void }) {
  const tone = PROV_TONE[beat.provenance.kind];
  return (
    <div className={`beat ${active ? "is-active" : ""}`}>
      <div className="beat-no">BEAT {String(beat.index + 1).padStart(2, "0")}</div>
      <div className="beat-cap">{beat.caption || `Beat ${beat.index + 1}`}</div>
      <div>
        <span className={`chip prov ${tone.cls}`}>
          <span aria-hidden style={{ marginRight: 4 }}>{tone.icon}</span>
          {beat.provenance.label}
          <Explain title="What this frame is" label="?" width={340}>
            <p className="ex-p">{beat.provenance.detail}</p>
            {beat.provenance.quality_score !== null && (
              <p className="ex-p"><b>Image quality score:</b> {beat.provenance.quality_score}/100</p>
            )}
            {beat.provenance.url && (
              <p className="ex-p">
                <a className="ex-link" href={beat.provenance.url} target="_blank" rel="noreferrer">Open the original image</a>
              </p>
            )}
          </Explain>
        </span>
      </div>
      <div className="beat-when">
        {clock(beat.start)}–{clock(beat.end)} · lines {beat.segment_range[0] + 1}–{beat.segment_range[1] + 1}
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn sm" onClick={onPlay}>▶ Play from here</button>
        {beat.claim_ids.length > 0 && (
          <span className="dim" style={{ fontSize: 11 }}>{beat.claim_ids.length} {beat.claim_ids.length === 1 ? "claim" : "claims"}</span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Chrome
 * ------------------------------------------------------------------ */

function StatusPill({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    ready: ["✓ ready", "good"],
    needs_review: ["⚑ needs review", "warm"],
    failed: ["✕ failed", "trend"],
    script_ready: ["script ready", "ai"],
    draft: ["draft", ""],
    queued: ["queued", ""],
    analyzing: ["analyzing", "warm"],
    scripting: ["writing", "warm"],
    synthesizing: ["voicing", "warm"],
    evaluating: ["checking the gate", "warm"],
  };
  const [label, cls] = map[status] ?? [status.replace(/_/g, " "), ""];
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
        <div className="muted" style={{ fontSize: 13, marginBottom: 18 }}>A new episode is generated natively in the selected language with matching voices. This one is preserved.</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          {LANGUAGES.map((l) => (
            <button
              key={l.code}
              onClick={() => l.code !== currentLang && onPick(l.code)}
              disabled={l.code === currentLang}
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
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
