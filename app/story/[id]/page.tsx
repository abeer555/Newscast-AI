"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api, useStore, timeAgo } from "@/lib/store";
import AudioPlayer from "@/components/AudioPlayer";

interface Article { id: string; title: string; summary: string; url: string; author: string | null; published_at: number; image_url: string | null; source_name: string; lean: string; country: string; similarity: number; }
interface Intel {
  headline: string; lede: string; summary_long: string; category: string; importance: number; sentiment: number;
  key_facts: { fact: string; confidence: string }[];
  entities: { name: string; type: string }[];
  why_it_matters: string; what_next: string;
  framing: { source: string; lean: string; headline: string; framing: string; emphasis: string[]; tone: string; omits: string }[];
  consensus: string[]; disagreements: string[];
  timeline: { time: string; event: string }[];
  podcast_angle: string;
}
interface EpisodeLite { id: string; title: string; status: string; language: string; format: string; audio_duration: number | null; created_at: number; }
interface Story {
  id: string; title: string; category: string; trend_score: number; velocity: number; first_seen: number; last_updated: number;
  intelligence: Intel | null; articles: Article[]; episodes: EpisodeLite[]; topics: string[];
}

const CONF_COLOR: Record<string, string> = { confirmed: "var(--good)", reported: "var(--warm)", disputed: "var(--bad)" };
const TONE_EMOJI: Record<string, string> = { alarmed: "🚨", neutral: "📰", optimistic: "🌤", critical: "🔍", celebratory: "🎉", cautious: "🧭" };

export default function StoryPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const pushToast = useStore((s) => s.pushToast);
  const [story, setStory] = useState<Story | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [tab, setTab] = useState<"intel" | "framing" | "timeline" | "coverage">("intel");

  const load = async () => setStory(await api<Story>(`/api/stories/${id}`));
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [id]);

  const analyze = async (force = false) => {
    setAnalyzing(true);
    try {
      await api(`/api/stories/${id}`, { method: "POST", body: JSON.stringify({ analyze: true, force }) });
      await load();
      pushToast("Intelligence dossier complete", "good");
    } catch (e) { pushToast(`Analysis failed: ${e}`, "bad"); }
    setAnalyzing(false);
  };

  if (!story) return <div style={{ padding: 40 }}><div className="skeleton" style={{ height: 300 }} /></div>;
  const intel = story.intelligence;

  return (
    <div>
      <Link href="/" className="dim" style={{ fontSize: 13 }}>← Command Deck</Link>
      <div className="page-head" style={{ marginTop: 10 }}>
        <div style={{ maxWidth: 820 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
            <span className="chip cat">{intel?.category ?? story.category}</span>
            <span className="chip trend">heat {Math.round(story.trend_score)}</span>
            <span className="chip src">{new Set(story.articles.map((a) => a.source_name)).size} sources</span>
            <span className="chip">{story.articles.length} articles</span>
            <span className="chip">{timeAgo(story.last_updated)}</span>
          </div>
          <h1 className="page-title" style={{ fontSize: 27 }}>{intel?.headline ?? story.title}</h1>
          {intel && <div className="page-sub" style={{ fontSize: 15, lineHeight: 1.55 }}>{intel.lede}</div>}
        </div>
        <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>
          <button className="btn" onClick={() => analyze(!!intel)} disabled={analyzing}>
            {analyzing ? "Analyzing…" : intel ? "Re-analyze" : "Run intelligence"}
          </button>
          <button className="btn primary" onClick={() => (intel ? setGenOpen(true) : pushToast("Run intelligence first for a grounded script", "info"))}>
            ✦ Produce podcast
          </button>
        </div>
      </div>

      {story.episodes.filter((e) => e.status === "ready").length > 0 && (
        <div className="card pad" style={{ marginBottom: 18 }}>
          <div className="label" style={{ fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase", color: "var(--text-3)", fontWeight: 600, marginBottom: 12 }}>Episodes from this story</div>
          <div style={{ display: "grid", gap: 10 }}>
            {story.episodes.filter((e) => e.status === "ready").map((e) => (
              <Link key={e.id} href={`/studio/${e.id}`} className="card pad" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--panel-2)" }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14.5 }}>{e.title}</div>
                  <div className="dim" style={{ fontSize: 12, marginTop: 3 }}>{e.format} · {e.language.toUpperCase()}</div>
                </div>
                <span className="chip good">▶ ready</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {intel ? (
        <>
          <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
            {(["intel", "framing", "timeline", "coverage"] as const).map((t) => (
              <button key={t} className="btn sm" onClick={() => setTab(t)}
                style={{ background: tab === t ? "var(--panel-3)" : "var(--panel)", color: tab === t ? "var(--accent)" : "var(--text-2)" }}>
                {t === "intel" ? "Intelligence" : t === "framing" ? "Source framing" : t === "timeline" ? "Timeline" : `Coverage (${story.articles.length})`}
              </button>
            ))}
          </div>

          {tab === "intel" && (
            <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 20, alignItems: "start" }}>
              <div className="grid">
                <div className="card pad">
                  <div className="label" style={{ fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase", color: "var(--text-3)", fontWeight: 600, marginBottom: 12 }}>The story</div>
                  <p style={{ lineHeight: 1.7, margin: 0 }}>{intel.summary_long}</p>
                </div>
                <div className="card pad">
                  <div className="label" style={{ fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase", color: "var(--text-3)", fontWeight: 600, marginBottom: 12 }}>Key facts</div>
                  <div style={{ display: "grid", gap: 10 }}>
                    {intel.key_facts.map((f, i) => (
                      <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: CONF_COLOR[f.confidence] ?? "var(--text-3)", marginTop: 6, flexShrink: 0 }} title={f.confidence} />
                        <div>
                          <div style={{ fontSize: 14, lineHeight: 1.5 }}>{f.fact}</div>
                          <div className="dim" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>{f.confidence}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="grid c2">
                  <div className="card pad" style={{ borderLeft: "3px solid var(--accent)" }}>
                    <div className="label" style={{ fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase", color: "var(--accent)", fontWeight: 600, marginBottom: 8 }}>Why it matters</div>
                    <div style={{ fontSize: 14, lineHeight: 1.6 }}>{intel.why_it_matters}</div>
                  </div>
                  <div className="card pad" style={{ borderLeft: "3px solid var(--accent-2)" }}>
                    <div className="label" style={{ fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase", color: "var(--accent-2)", fontWeight: 600, marginBottom: 8 }}>What happens next</div>
                    <div style={{ fontSize: 14, lineHeight: 1.6 }}>{intel.what_next}</div>
                  </div>
                </div>
                <div className="card pad">
                  <div className="label" style={{ fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase", color: "var(--text-3)", fontWeight: 600, marginBottom: 12 }}>Consensus & fault lines</div>
                  <div className="grid c2">
                    <div>
                      <div className="muted" style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>All sources agree</div>
                      <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7, fontSize: 13.5 }}>{intel.consensus.map((c, i) => <li key={i}>{c}</li>)}</ul>
                    </div>
                    <div>
                      <div className="muted" style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>Where coverage diverges</div>
                      <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7, fontSize: 13.5 }}>{intel.disagreements.map((c, i) => <li key={i}>{c}</li>)}</ul>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid">
                <div className="card pad">
                  <div className="label" style={{ fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase", color: "var(--text-3)", fontWeight: 600, marginBottom: 12 }}>Assessment</div>
                  <Gauge label="Importance" value={intel.importance} max={100} color="var(--hot)" />
                  <Gauge label="Sentiment" value={Math.round((intel.sentiment + 1) * 50)} max={100} color="var(--accent)" hint={intel.sentiment > 0.3 ? "positive" : intel.sentiment < -0.3 ? "negative" : "neutral"} />
                  <div className="hr" />
                  <div className="label" style={{ fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase", color: "var(--text-3)", fontWeight: 600, margin: "10px 0 10px" }}>Entities</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {intel.entities.map((e, i) => <span key={i} className="chip">{e.type === "person" ? "👤" : e.type === "org" ? "🏢" : e.type === "place" ? "📍" : "•"} {e.name}</span>)}
                  </div>
                </div>
                <div className="card pad" style={{ background: "linear-gradient(135deg, rgba(91,227,200,0.07), rgba(79,195,255,0.05))" }}>
                  <div className="label" style={{ fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase", color: "var(--accent)", fontWeight: 600, marginBottom: 8 }}>✦ Podcast angle</div>
                  <div style={{ fontSize: 14, lineHeight: 1.65, fontStyle: "italic" }}>{intel.podcast_angle}</div>
                </div>
              </div>
            </div>
          )}

          {tab === "framing" && (
            <div className="grid c2">
              {intel.framing.map((f, i) => (
                <div key={i} className="card pad">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 15 }}>{f.source}</div>
                      <div className="dim" style={{ fontSize: 12 }}>{f.lean} lean</div>
                    </div>
                    <span style={{ fontSize: 20 }} title={f.tone}>{TONE_EMOJI[f.tone] ?? "📰"}</span>
                  </div>
                  <div className="muted" style={{ fontSize: 13, fontStyle: "italic", marginBottom: 10 }}>“{f.headline}”</div>
                  <p style={{ fontSize: 13.5, lineHeight: 1.6, margin: "0 0 10px" }}>{f.framing}</p>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
                    {f.emphasis.map((e, j) => <span key={j} className="chip src">{e}</span>)}
                  </div>
                  <div className="dim" style={{ fontSize: 12.5 }}><b>Omits:</b> {f.omits}</div>
                </div>
              ))}
            </div>
          )}

          {tab === "timeline" && (
            <div className="card pad" style={{ maxWidth: 780 }}>
              {intel.timeline.map((t, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "120px 24px 1fr", gap: 12, paddingBottom: i < intel.timeline.length - 1 ? 18 : 0 }}>
                  <div className="mono dim" style={{ fontSize: 12, textAlign: "right" }}>{t.time}</div>
                  <div style={{ position: "relative", display: "flex", justifyContent: "center" }}>
                    <div style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--accent)", flexShrink: 0, zIndex: 1, marginTop: 2 }} />
                    {i < intel.timeline.length - 1 && <div style={{ position: "absolute", top: 14, bottom: -18, width: 2, background: "var(--line)" }} />}
                  </div>
                  <div style={{ fontSize: 13.5, lineHeight: 1.55 }}>{t.event}</div>
                </div>
              ))}
            </div>
          )}

          {tab === "coverage" && (
            <div className="card">
              {story.articles.map((a) => (
                <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="story-row" style={{ gridTemplateColumns: "1fr auto" }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="story-title">{a.title}</div>
                    <div className="story-meta">
                      <span className="chip src">{a.source_name}</span>
                      <span className="chip">{a.lean}</span>
                      <span>{timeAgo(a.published_at)}</span>
                      {a.author && <span>by {a.author}</span>}
                    </div>
                  </div>
                  <span className="dim" style={{ fontSize: 12 }}>↗</span>
                </a>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="card pad" style={{ textAlign: "center", padding: 60 }}>
          <div style={{ fontSize: 42, marginBottom: 12 }}>✦</div>
          <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>No intelligence yet</div>
          <div className="muted" style={{ marginBottom: 20 }}>Run the AI analysis to get the full dossier: facts, framing, timeline, and the podcast angle.</div>
          <button className="btn primary" onClick={() => analyze(false)} disabled={analyzing}>{analyzing ? "Analyzing…" : "Run intelligence"}</button>
          <div className="hr" />
          <div className="card" style={{ textAlign: "left" }}>
            {story.articles.map((a) => (
              <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="story-row" style={{ gridTemplateColumns: "1fr auto" }}>
                <div><div className="story-title">{a.title}</div><div className="story-meta"><span className="chip src">{a.source_name}</span><span>{timeAgo(a.published_at)}</span></div></div>
                <span className="dim">↗</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {genOpen && <GenerateModal clusterId={story.id} onClose={() => setGenOpen(false)} onGo={(id) => router.push(`/studio/${id}`)} />}
    </div>
  );
}

export function GenerateModal({ clusterId, onClose, onGo }: { clusterId: string; onClose: () => void; onGo: (episodeId: string) => void }) {
  const pushToast = useStore((s) => s.pushToast);
  const [format, setFormat] = useState<"briefing" | "deepdive" | "debate">("briefing");
  const [language, setLanguage] = useState<"en" | "ar">("en");
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true);
    try {
      const { id } = await api<{ id: string }>("/api/episodes", { method: "POST", body: JSON.stringify({ clusterId, format, language, style: "conversational" }) });
      pushToast("Pipeline started — writing script", "good");
      onGo(id);
    } catch (e) { pushToast(`${e}`, "bad"); setBusy(false); }
  };

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 21, fontWeight: 700, marginBottom: 4 }}>Produce episode</div>
        <div className="muted" style={{ fontSize: 13.5, marginBottom: 20 }}>Script → multi-voice synthesis → quality review. Fully automatic.</div>

        <div className="label" style={{ fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase", color: "var(--text-3)", fontWeight: 600, marginBottom: 8 }}>Format</div>
        <div style={{ display: "grid", gap: 8, marginBottom: 18 }}>
          {([
            ["briefing", "Daily Briefing", "~90s · punchy essentials, energetic"],
            ["deepdive", "Deep Dive", "~3min · analysis, framing, what's next"],
            ["debate", "Two Chairs", "~2.5min · hosts explore competing readings"],
          ] as const).map(([v, name, desc]) => (
            <div key={v} onClick={() => setFormat(v)} className="card pad" style={{ cursor: "pointer", borderColor: format === v ? "var(--accent)" : "var(--line-soft)", background: format === v ? "rgba(91,227,200,0.06)" : "var(--panel-2)", padding: "12px 15px" }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{name}</div>
              <div className="dim" style={{ fontSize: 12.5 }}>{desc}</div>
            </div>
          ))}
        </div>

        <div className="label" style={{ fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase", color: "var(--text-3)", fontWeight: 600, marginBottom: 8 }}>Language & cast</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 22 }}>
          <div onClick={() => setLanguage("en")} className="card pad" style={{ cursor: "pointer", borderColor: language === "en" ? "var(--accent)" : "var(--line-soft)", background: language === "en" ? "rgba(91,227,200,0.06)" : "var(--panel-2)", padding: "12px 15px" }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>English</div>
            <div className="dim" style={{ fontSize: 12.5 }}>Autumn & Daniel · Orpheus expressive</div>
          </div>
          <div onClick={() => setLanguage("ar")} className="card pad" style={{ cursor: "pointer", borderColor: language === "ar" ? "var(--accent)" : "var(--line-soft)", background: language === "ar" ? "rgba(91,227,200,0.06)" : "var(--panel-2)", padding: "12px 15px" }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>العربية</div>
            <div className="dim" style={{ fontSize: 12.5 }}>نورة و فهد · Saudi dialect</div>
          </div>
        </div>

        <button className={`btn primary ${busy ? "loading" : ""}`} style={{ width: "100%", justifyContent: "center", padding: 13 }} onClick={go} disabled={busy}>
          {busy ? "Starting" : "Generate episode"}
        </button>
      </div>
    </div>
  );
}

function Gauge({ label, value, max, color, hint }: { label: string; value: number; max: number; color: string; hint?: string }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 6 }}>
        <span className="muted">{label}</span>
        <span style={{ color }}>{value}{hint ? ` · ${hint}` : ""}</span>
      </div>
      <div className="progress-track"><div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 99, transition: "width 0.6s ease" }} /></div>
    </div>
  );
}
