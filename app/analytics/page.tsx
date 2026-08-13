"use client";
import { useEffect, useState } from "react";
import { api, useInterval } from "@/lib/store";

interface Analytics {
  counts: { articles: number; clusters: number; episodes: number; episodes_ready: number; sources: number; audio_minutes: number; plays: number };
  llm: { model: string; calls: number; prompt: number; completion: number; avg_latency: number }[];
  tts: { calls: number; avg_latency: number; chars: number };
  recent: { kind: string; model: string | null; tokens_prompt: number; tokens_completion: number; latency_ms: number; created_at: number }[];
  categories: { category: string; n: number }[];
  by_status: { status: string; n: number }[];
  quality: { avg: number | null };
}

export default function AnalyticsPage() {
  const [a, setA] = useState<Analytics | null>(null);
  const load = async () => setA(await api<Analytics>("/api/analytics"));
  useEffect(() => { void load(); }, []);
  useInterval(load, 8000);

  if (!a) return <div className="skeleton" style={{ height: 400 }} />;
  const maxCat = Math.max(1, ...a.categories.map((c) => c.n));

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Newsroom Analytics</h1>
          <div className="page-sub">What the machine is doing, thinking, and spending — in real time.</div>
        </div>
      </div>

      <div className="grid c4" style={{ marginBottom: 20 }}>
        <div className="card stat"><div className="label">Articles ingested</div><div className="value" style={{ color: "var(--accent-2)" }}>{a.counts.articles}</div></div>
        <div className="card stat"><div className="label">Stories tracked</div><div className="value" style={{ color: "var(--accent-3)" }}>{a.counts.clusters}</div></div>
        <div className="card stat"><div className="label">Episodes on air</div><div className="value" style={{ color: "var(--accent)" }}>{a.counts.episodes_ready}<span style={{ fontSize: 15, color: "var(--text-3)" }}>/{a.counts.episodes}</span></div></div>
        <div className="card stat"><div className="label">Avg episode quality</div><div className="value" style={{ color: "var(--good)" }}>{a.quality.avg ?? "—"}</div></div>
      </div>

      <div className="grid c2" style={{ alignItems: "start" }}>
        <div className="card pad">
          <div className="label" style={{ fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase", color: "var(--text-3)", fontWeight: 600, marginBottom: 14 }}>Model usage</div>
          {a.llm.length === 0 && a.tts.calls === 0 && <div className="dim">No AI calls yet.</div>}
          {a.llm.map((m) => (
            <div key={m.model} style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 5 }}>
                <span className="mono" style={{ color: "var(--accent)" }}>{m.model}</span>
                <span className="dim">{m.calls} calls · avg {m.avg_latency}ms</span>
              </div>
              <div className="mono dim" style={{ fontSize: 11.5 }}>↑ {m.prompt?.toLocaleString()} prompt tokens · ↓ {m.completion?.toLocaleString()} completion tokens</div>
            </div>
          ))}
          {a.tts.calls > 0 && (
            <div className="card pad" style={{ background: "var(--panel-2)", marginTop: 8 }}>
              <span className="mono" style={{ color: "var(--accent-2)", fontSize: 13 }}>kokoro TTS</span>
              <div className="mono dim" style={{ fontSize: 11.5, marginTop: 4 }}>{a.tts.calls} chunks · {a.tts.chars?.toLocaleString()} chars · avg {a.tts.avg_latency}ms</div>
            </div>
          )}
        </div>

        <div className="card pad">
          <div className="label" style={{ fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase", color: "var(--text-3)", fontWeight: 600, marginBottom: 14 }}>Coverage mix</div>
          {a.categories.map((c) => (
            <div key={c.category} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 4 }}>
                <span style={{ textTransform: "capitalize" }}>{c.category}</span><span className="mono dim">{c.n}</span>
              </div>
              <div className="progress-track"><div className="progress-fill" style={{ width: `${(c.n / maxCat) * 100}%`, background: "linear-gradient(90deg, var(--accent-3), var(--accent-2))" }} /></div>
            </div>
          ))}
          <div className="hr" />
          <div className="label" style={{ fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase", color: "var(--text-3)", fontWeight: 600, marginBottom: 10 }}>Episode states</div>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
            {a.by_status.map((s) => <span key={s.status} className="chip">{s.status}: {s.n}</span>)}
          </div>
        </div>
      </div>

      <div className="card pad" style={{ marginTop: 20 }}>
        <div className="label" style={{ fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase", color: "var(--text-3)", fontWeight: 600, marginBottom: 12 }}>Raw event stream</div>
        <div style={{ display: "grid", gap: 5, maxHeight: 320, overflow: "auto" }}>
          {a.recent.map((r, i) => (
            <div key={i} className="mono dim" style={{ fontSize: 11.5, display: "flex", gap: 14, justifyContent: "space-between" }}>
              <span style={{ color: r.kind === "llm_call" ? "var(--accent)" : r.kind === "tts_call" ? "var(--accent-2)" : r.kind === "error" ? "var(--bad)" : "var(--text-2)" }}>{r.kind}</span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.model ?? ""}</span>
              <span>{r.latency_ms}ms</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
