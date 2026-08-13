"use client";
import { useEffect, useState } from "react";
import { api, useStore } from "@/lib/store";

const TOPICS = ["politics", "conflict", "technology", "business", "health", "climate", "sports", "science", "ai", "economy", "space", "energy", "crypto", "europe", "middle east", "asia", "us"];

export default function SettingsPage() {
  const pushToast = useStore((s) => s.pushToast);
  const [interests, setInterests] = useState<string[]>([]);
  const lang = "en";
  const [voice, setVoice] = useState("af_heart");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      const p = await api<{ interests: string[]; preferred_language: "en" | "ar"; preferred_voice: string }>("/api/profile");
      setInterests(p.interests); setVoice(p.preferred_voice); setLoaded(true);
    })();
  }, []);

  const toggle = (t: string) => setInterests((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  const save = async () => {
    await api("/api/profile", { method: "POST", body: JSON.stringify({ interests, preferred_language: lang, preferred_voice: voice }) });
    pushToast("Profile saved — your feed is now tuned", "good");
  };

  if (!loaded) return <div className="skeleton" style={{ height: 300 }} />;

  return (
    <div style={{ maxWidth: 720 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title">Personalize</h1>
          <div className="page-sub">Tune the newsroom's instincts. Your "For you" feed and default podcast settings adapt.</div>
        </div>
      </div>

      <div className="card pad" style={{ marginBottom: 18 }}>
        <div className="label" style={{ fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase", color: "var(--text-3)", fontWeight: 600, marginBottom: 12 }}>I'm interested in</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {TOPICS.map((t) => (
            <button key={t} onClick={() => toggle(t)} className="btn sm"
              style={{ background: interests.includes(t) ? "rgba(91,227,200,0.12)" : "var(--panel-2)", borderColor: interests.includes(t) ? "var(--accent)" : "var(--line)", color: interests.includes(t) ? "var(--accent)" : "var(--text-2)", textTransform: "capitalize" }}>
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="grid c2" style={{ marginBottom: 18 }}>
        <div className="card pad">
          <div className="label" style={{ fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase", color: "var(--text-3)", fontWeight: 600, marginBottom: 12 }}>Default voice</div>
          <select className="btn" style={{ width: "100%", background: "var(--panel-2)" }} value={voice} onChange={(e) => setVoice(e.target.value)}>
            {["af_heart", "af_bella", "af_nicole", "af_sarah", "am_adam", "am_michael"].map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>
      </div>

      <button className="btn primary" onClick={save}>Save profile</button>
    </div>
  );
}
