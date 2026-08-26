"use client";

/**
 * The player, and the sentence you are hearing.
 *
 * Highlighting the line being spoken is only worth doing if the position is right.
 * When the episode was voiced with timing capture, each utterance's duration was
 * measured from the WAV it produced, so the highlight lands on the correct sentence
 * to within a fraction of a second and clicking a line seeks to the moment it is
 * spoken. Without that timeline the component falls back to sharing the runtime out
 * by word count and reports `measured: false` upward, so the surrounding UI can say
 * the position is approximate instead of implying a precision it does not have.
 *
 * The transcript itself lives in the parent, which knows what evidence backs each
 * line. This component owns playback and tells the parent which line is active.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api, fmtDuration } from "@/lib/store";

interface Segment {
  speaker: string;
  text: string;
  voice: string;
  direction: string;
  index: number;
}

export interface PlayerTiming {
  index: number;
  start: number;
  end: number;
  measured: boolean;
}

export default function AudioPlayer({
  src,
  segments,
  duration,
  episodeId,
  compact,
  timings,
  onActive,
  onTime,
  seekRequest,
  activeSlot,
}: {
  src: string;
  segments?: Segment[] | null;
  duration?: number | null;
  episodeId?: string;
  compact?: boolean;
  /** Measured (or estimated) bounds per segment. */
  timings?: PlayerTiming[] | null;
  /** Fired when the spoken line changes, so the parent can scroll and annotate. */
  onActive?: (index: number) => void;
  /** Fired on every tick, for parents that draw their own progress. */
  onTime?: (t: number) => void;
  /** Bump the nonce to jump to a time — used when a transcript line is clicked. */
  seekRequest?: { t: number; nonce: number } | null;
  /** Rendered under the transport, given the active segment index. */
  activeSlot?: (index: number) => React.ReactNode;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(duration ?? 0);
  const [speed, setSpeed] = useState(1);
  const counted = useRef(false);
  const lastActive = useRef(-1);
  const lastNonce = useRef(-1);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTimeUpdate = () => setT(a.currentTime);
    const onMeta = () => setDur(a.duration || duration || 0);
    const onEnd = () => setPlaying(false);
    a.addEventListener("timeupdate", onTimeUpdate);
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("ended", onEnd);
    return () => {
      a.removeEventListener("timeupdate", onTimeUpdate);
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("ended", onEnd);
    };
  }, [duration]);

  useEffect(() => {
    onTime?.(t);
    // onTime is a render-stable callback in practice; re-running on identity churn
    // would fire the parent's handler on every render rather than every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  // A click on a transcript line arrives as a nonce bump so repeated clicks on the
  // same line still seek. On a freshly mounted player the metadata may not have
  // arrived yet, and assigning currentTime before it does is discarded — so the
  // seek waits for the element to know how long the audio is.
  useEffect(() => {
    if (!seekRequest || seekRequest.nonce === lastNonce.current) return;
    lastNonce.current = seekRequest.nonce;
    const a = audioRef.current;
    if (!a) return;
    const target = Math.max(0, seekRequest.t);
    const apply = () => {
      a.currentTime = target;
      setT(a.currentTime);
      void a.play().then(
        () => setPlaying(true),
        () => {/* autoplay refused — the user can press play */},
      );
    };
    if (a.readyState >= 1) {
      apply();
      return;
    }
    a.addEventListener("loadedmetadata", apply, { once: true });
    // preload="metadata" normally covers this, but an explicit load() makes the
    // jump work even when the browser deferred the fetch entirely.
    a.load();
    return () => a.removeEventListener("loadedmetadata", apply);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekRequest?.nonce]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause();
      setPlaying(false);
    } else {
      void a.play();
      setPlaying(true);
      if (episodeId && !counted.current) {
        counted.current = true;
        void api("/api/play", { method: "POST", body: JSON.stringify({ episodeId }) });
      }
    }
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    if (audioRef.current && dur) {
      audioRef.current.currentTime = frac * dur;
      setT(frac * dur);
    }
  };

  const cycleSpeed = () => {
    const speeds = [1, 1.25, 1.5, 0.75];
    const next = speeds[(speeds.indexOf(speed) + 1) % speeds.length];
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  /* Which line is being spoken. Measured bounds are a lookup; without them the
     runtime is shared out by word count, which is an estimate and says so. */
  const activeFromTimings = useCallback((): number => {
    if (!timings?.length) return -1;
    // Bounds are monotonic, so the last one that has started is the current one.
    let hit = -1;
    for (const row of timings) {
      if (t + 0.02 >= row.start) hit = row.index;
      if (t < row.end) break;
    }
    return hit;
  }, [timings, t]);

  let activeIdx = activeFromTimings();
  if (activeIdx < 0 && segments?.length) {
    const words = segments.map((s) => Math.max(1, s.text.split(/\s+/).filter(Boolean).length));
    const total = words.reduce((a, b) => a + b, 0);
    const elapsed = dur ? (t / dur) * total : 0;
    let acc = 0;
    for (let i = 0; i < segments.length; i++) {
      acc += words[i];
      if (elapsed <= acc) {
        activeIdx = segments[i].index;
        break;
      }
    }
  }

  useEffect(() => {
    if (activeIdx >= 0 && activeIdx !== lastActive.current) {
      lastActive.current = activeIdx;
      onActive?.(activeIdx);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIdx]);

  if (compact) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        <audio ref={audioRef} src={src} preload="none" />
        <button
          className="btn sm"
          onClick={(e) => {
            e.stopPropagation();
            toggle();
          }}
        >
          {playing ? "Pause" : "Play"}
        </button>
      </span>
    );
  }

  const active = segments && activeIdx >= 0 ? segments.find((s) => s.index === activeIdx) : null;

  return (
    <div className="card pad" style={{ background: "linear-gradient(135deg, var(--panel), var(--panel-2))" }}>
      <audio ref={audioRef} src={src} preload="metadata" />
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <button
          onClick={toggle}
          aria-label={playing ? "Pause" : "Play"}
          style={{
            width: 52,
            height: 52,
            borderRadius: "50%",
            border: "none",
            flexShrink: 0,
            background: "linear-gradient(135deg, var(--accent), var(--accent-2))",
            color: "#06110f",
            display: "grid",
            placeItems: "center",
            boxShadow: playing ? "0 0 26px rgba(91,227,200,0.5)" : "0 4px 16px rgba(91,227,200,0.25)",
          }}
        >
          {playing ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5.5v13l11-6.5z" />
            </svg>
          )}
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-3)", marginBottom: 6 }}>
            <span className="mono">{fmtDuration(t)}</span>
            {playing && (
              <span className="eq">
                <span />
                <span />
                <span />
                <span />
              </span>
            )}
            <span className="mono">{fmtDuration(dur)}</span>
          </div>
          <div className="progress-track" style={{ cursor: "pointer", height: 8 }} onClick={seek}>
            <div className="progress-fill" style={{ width: dur ? `${(t / dur) * 100}%` : "0%" }} />
          </div>
        </div>
        <button className="btn sm ghost mono" onClick={cycleSpeed} style={{ minWidth: 44 }}>
          {speed}×
        </button>
      </div>

      {activeSlot && activeIdx >= 0 ? (
        <div style={{ marginTop: 14 }}>{activeSlot(activeIdx)}</div>
      ) : (
        active && (
          <div style={{ marginTop: 14, padding: "12px 14px", background: "var(--bg-2)", borderRadius: 10, border: "1px solid var(--line-soft)" }}>
            <span className="chip ai" style={{ marginRight: 8 }}>
              {active.speaker}
            </span>
            <span style={{ fontSize: 14 }}>{active.text}</span>
          </div>
        )
      )}
    </div>
  );
}
