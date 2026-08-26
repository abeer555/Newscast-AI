"use client";

/**
 * Episode production dialog.
 *
 * Lifted out of the story page when that page became the trust centre. Behaviour
 * is unchanged: pick a format and a language, start the pipeline, hand the new
 * episode id back to the caller so it can begin polling.
 */

import { useState } from "react";
import { api, useStore } from "@/lib/store";

const LANGUAGES = [
  { code: "en", label: "English", native: "English", cast: "Heart & Adam" },
  { code: "hi", label: "Hindi", native: "हिन्दी", cast: "Priya & Arjun" },
  { code: "es", label: "Spanish", native: "Español", cast: "Dora & Alex" },
  { code: "fr", label: "French", native: "Français", cast: "Siwis & Sylvie" },
  { code: "pt", label: "Portuguese", native: "Português", cast: "Dora & Alex" },
  { code: "zh", label: "Chinese", native: "中文", cast: "Xiaobei & Yunxi" },
];

const FORMATS = [
  ["briefing", "Daily Briefing", "~90s · punchy essentials, energetic"],
  ["deepdive", "Deep Dive", "~3min · analysis, framing, what's next"],
  ["debate", "Two Chairs", "~2.5min · hosts explore competing readings"],
  ["video", "Full Length", "10-15min · extensive documentary dive"],
  ["reel", "Short Reel", "30-60s · vertical, social-native hook"],
] as const;

export default function GenerateModal({
  clusterId,
  onClose,
  onGo,
}: {
  clusterId: string;
  onClose: () => void;
  onGo: (episodeId: string) => void;
}) {
  const pushToast = useStore((s) => s.pushToast);
  const [format, setFormat] = useState<(typeof FORMATS)[number][0]>("briefing");
  const [language, setLanguage] = useState("en");
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true);
    try {
      const { id } = await api<{ id: string }>("/api/episodes", {
        method: "POST",
        body: JSON.stringify({ clusterId, format, language, style: "conversational" }),
      });
      pushToast("Pipeline started — writing script. Watch progress below.", "good");
      onGo(id);
      onClose();
    } catch (e) {
      pushToast(`${e}`, "bad");
      setBusy(false);
    }
  };

  const selectedLang = LANGUAGES.find((l) => l.code === language) ?? LANGUAGES[0];

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 21, fontWeight: 700, marginBottom: 4 }}>Produce episode</div>
        <div className="muted" style={{ fontSize: 13.5, marginBottom: 20 }}>
          Script → multi-voice synthesis → quality review. Every claim in the script is checked against the
          evidence layer before the episode is marked publishable.
        </div>

        <div className="section-label">Format</div>
        <div style={{ display: "grid", gap: 8, marginBottom: 18 }}>
          {FORMATS.map(([v, name, desc]) => (
            <div
              key={v}
              onClick={() => setFormat(v)}
              className="card pad"
              style={{
                cursor: "pointer",
                borderColor: format === v ? "var(--accent)" : "var(--line-soft)",
                background: format === v ? "rgba(91,227,200,0.06)" : "var(--panel-2)",
                padding: "12px 15px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{name}</div>
                <div className="dim" style={{ fontSize: 12.5 }}>{desc}</div>
              </div>
              {v === "reel" && <span className="chip warm" style={{ fontSize: 10, flexShrink: 0 }}>9:16</span>}
              {v === "video" && <span className="chip ai" style={{ fontSize: 10, flexShrink: 0 }}>2-pass</span>}
            </div>
          ))}
        </div>

        <div className="section-label">Language</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 18 }}>
          {LANGUAGES.map((l) => (
            <div
              key={l.code}
              onClick={() => setLanguage(l.code)}
              className="card pad"
              style={{
                cursor: "pointer",
                borderColor: language === l.code ? "var(--accent)" : "var(--line-soft)",
                background: language === l.code ? "rgba(91,227,200,0.06)" : "var(--panel-2)",
                padding: "10px 12px",
                textAlign: "center",
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 15 }}>{l.native}</div>
              <div className="dim" style={{ fontSize: 11 }}>{l.label}</div>
            </div>
          ))}
        </div>

        <div className="section-label">Cast</div>
        <div style={{ marginBottom: 22 }}>
          <div className="card pad" style={{ borderColor: "var(--accent)", background: "rgba(91,227,200,0.06)", padding: "12px 15px" }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{selectedLang.native} · {selectedLang.cast}</div>
            <div className="dim" style={{ fontSize: 12.5 }}>
              Script generated natively in {selectedLang.label} · Kokoro expressive voices
            </div>
          </div>
        </div>

        <button
          className={`btn primary ${busy ? "loading" : ""}`}
          style={{ width: "100%", justifyContent: "center", padding: 13 }}
          onClick={go}
          disabled={busy}
        >
          {busy ? "Starting" : "Generate episode"}
        </button>
      </div>
    </div>
  );
}
