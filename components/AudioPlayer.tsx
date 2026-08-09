"use client";
import { useEffect, useRef, useState } from "react";
import { api, fmtDuration, store } from "@/lib/store";

interface Segment { speaker: string; text: string; voice: string; direction: string; index: number; }

export default function AudioPlayer({ src, segments, duration, episodeId, compact }: {
  src: string;
  segments?: Segment[] | null;
  duration?: number | null;
  episodeId?: string;
  compact?: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(duration ?? 0);
  const [speed, setSpeed] = useState(1);
  const counted = useRef(false);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => setT(a.currentTime);
    const onMeta = () => setDur(a.duration || duration || 0);
    const onEnd = () => setPlaying(false);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("ended", onEnd);
    return () => { a.removeEventListener("timeupdate", onTime); a.removeEventListener("loadedmetadata", onMeta); a.removeEventListener("ended", onEnd); };
  }, [duration]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) { a.pause(); setPlaying(false); }
    else {
      a.play();
      setPlaying(true);
      if (episodeId && !counted.current) { counted.current = true; void api("/api/play", { method: "POST", body: JSON.stringify({ episodeId }) }); }
    }
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    if (audioRef.current && dur) { audioRef.current.currentTime = frac * dur; setT(frac * dur); }
  };

  const cycleSpeed = () => {
    const speeds = [1, 1.25, 1.5, 0.75];
    const next = speeds[(speeds.indexOf(speed) + 1) % speeds.length];
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  // active segment approximation: proportional by text length
  const chars = segments?.reduce((a, s) => a + s.text.length, 0) ?? 0;
  const elapsedChars = dur ? (t / dur) * chars : 0;
  let acc = 0;
  let activeIdx = -1;
  if (segments) {
    for (const s of segments) { acc += s.text.length; if (elapsedChars <= acc) { activeIdx = s.index; break; } }
  }

  if (compact) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        <audio ref={audioRef} src={src} preload="none" />
        <button className="btn sm" onClick={(e) => { e.stopPropagation(); toggle(); }}>
          {playing ? "Pause" : "Play"}
        </button>
      </span>
    );
  }

  return (
    <div className="card pad" style={{ background: "linear-gradient(135deg, var(--panel), var(--panel-2))" }}>
      <audio ref={audioRef} src={src} preload="metadata" />
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <button
          onClick={toggle}
          style={{
            width: 52, height: 52, borderRadius: "50%", border: "none", flexShrink: 0,
            background: "linear-gradient(135deg, var(--accent), var(--accent-2))",
            color: "#06110f", display: "grid", placeItems: "center",
            boxShadow: playing ? "0 0 26px rgba(91,227,200,0.5)" : "0 4px 16px rgba(91,227,200,0.25)",
          }}
        >
          {playing ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>
          )}
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-3)", marginBottom: 6 }}>
            <span className="mono">{fmtDuration(t)}</span>
            {playing && <span className="eq"><span /><span /><span /><span /></span>}
            <span className="mono">{fmtDuration(dur)}</span>
          </div>
          <div className="progress-track" style={{ cursor: "pointer", height: 8 }} onClick={seek}>
            <div className="progress-fill" style={{ width: dur ? `${(t / dur) * 100}%` : "0%" }} />
          </div>
        </div>
        <button className="btn sm ghost mono" onClick={cycleSpeed} style={{ minWidth: 44 }}>{speed}×</button>
      </div>

      {segments && activeIdx >= 0 && (
        <div style={{ marginTop: 14, padding: "12px 14px", background: "var(--bg-2)", borderRadius: 10, border: "1px solid var(--line-soft)" }}>
          <span className="chip ai" style={{ marginRight: 8 }}>{segments[activeIdx]?.speaker}</span>
          <span style={{ fontSize: 14 }}>{segments[activeIdx]?.text}</span>
        </div>
      )}
    </div>
  );
}
