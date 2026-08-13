"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useStore } from "@/lib/store";

const NAV = [
  { href: "/", label: "Command Deck", icon: NewsIcon },
  { href: "/trending", label: "Trending", icon: FlameIcon },
  { href: "/india", label: "India", icon: LotusIcon },
  { href: "/library", label: "Podcast Library", icon: WavesIcon },
  { href: "/studio", label: "Studio", icon: MicIcon },
  { href: "/analytics", label: "Analytics", icon: ChartIcon },
  { href: "/settings", label: "Personalize", icon: SlidersIcon },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { stats, refreshStats, ingestLog, pushToast } = useStore((s) => ({ stats: s.stats, refreshStats: s.refreshStats, ingestLog: s.ingestLog, pushToast: s.pushToast }));

  useEffect(() => {
    refreshStats();
    const es = new EventSource("/api/stream");
    es.addEventListener("log", (ev) => {
      const e = JSON.parse(ev.data);
      useStore.getState().appendLog(`[${e.type}] ${e.message}`);
    });
    es.addEventListener("episode", (ev) => {
      const e = JSON.parse(ev.data);
      useStore.getState().updateEpisodeProgress(e);
      if (e.status === "ready") {
        pushToast(`Episode ready — ${e.stageLabel ?? ""}`, "good");
        refreshStats();
      }
      if (e.status === "failed") pushToast(`Generation failed: ${e.stageLabel}`, "bad");
    });
      es.addEventListener("model_api", (ev) => {
        const e = JSON.parse(ev.data);
        if (e.status === "pending") {
          useStore.getState().trackApiStart(e.id, e.name);
        } else {
          useStore.getState().trackApiEnd(e.id, e.status, e.ms);
        }
      });
      return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <div className="brand-mark">N</div>
          <div className="brand-name">
            NEWSCAST
            <small>AI NEWSROOM</small>
          </div>
        </div>
        <nav className="nav">
          {NAV.map((n) => {
            const Icon = n.icon;
            const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} className={active ? "active" : ""}>
                <span className="icon"><Icon /></span>
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="side-foot">
          <div><span className="live-dot" />Live ingest: {stats?.sources ?? "—"} sources</div>
          <div style={{ marginTop: 6 }}>{ingestLog[0] ?? "Standing by for the next news cycle…"}</div>
        </div>
      </aside>
      <main className="main">{children}</main>
      <Toasts />
      <ApiTracker />
    </div>
  );
}

function Toasts() {
  const { toasts, dismissToast } = useStore((s) => ({ toasts: s.toasts, dismissToast: s.dismissToast }));
  return (
    <div className="toast-wrap">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismissToast(t.id)}>{t.msg}</div>
      ))}
    </div>
  );
}

/* inline icons */
function NewsIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18"><path d="M4 5h13v14H4z"/><path d="M17 8h3v11a0 0 0 0 1 0 0h-3"/><path d="M7 9h7M7 13h7M7 17h4"/></svg>; }
function FlameIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18"><path d="M12 3s5 4.5 5 9.5A5 5 0 0 1 7 12.5C7 7.5 12 3 12 3z"/><path d="M12 12a2.5 2.5 0 0 0-2.5 2.5A2.5 2.5 0 0 0 12 17a2.5 2.5 0 0 0 2.5-2.5A2.5 2.5 0 0 0 12 12z"/></svg>; }
function LotusIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18"><path d="M12 3c-.6 3-2 5.2-3.5 7 2-.8 3.4-1 4-1s2 .2 4 1C15 8.2 13.6 6 13 3h-1z"/><path d="M4 21c2-.5 4-2 5.5-4M20 21c-2-.5-4-2-5.5-4M4 21c4.5-.5 8-3 8-7 0 4 3.5 6.5 8 7"/></svg>; }
function WavesIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18"><path d="M4 12h2M8 8v8M12 5v14M16 9v6M20 12h0"/></svg>; }
function MicIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>; }
function ChartIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18"><path d="M4 20V4"/><path d="M4 20h16"/><path d="M8 16v-5M12 16V8M16 16v-3"/></svg>; }
function SlidersIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18"><path d="M4 8h10M18 8h2M4 16h4M12 16h8"/><circle cx="16" cy="8" r="2"/><circle cx="10" cy="16" r="2"/></svg>; }

function ApiTracker() {
  const apiRequests = useStore((s) => s.apiRequests);
  if (!apiRequests || apiRequests.length === 0) return null;
  return (
    <div style={{ position: "fixed", bottom: 16, left: 16, background: "rgba(10,10,10,0.8)", backdropFilter: "blur(12px)", border: "1px solid var(--line-soft)", padding: "12px 14px", borderRadius: 12, fontSize: 11, zIndex: 9999, width: 280, display: "flex", flexDirection: "column", gap: 6, maxHeight: "35vh", overflowY: "auto", pointerEvents: "auto" }}>
      <div style={{ fontWeight: 600, color: "var(--text-3)", letterSpacing: 1.2, textTransform: "uppercase", fontSize: 10, marginBottom: 4 }}>Model API Tracker</div>
      {apiRequests.map(r => (
        <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontFamily: "var(--font-mono)" }}>
          <span style={{ color: r.status === "error" ? "var(--bad)" : "var(--text)", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap", flex: 1, paddingRight: 8 }}>{r.url}</span>
          <span style={{ color: r.status === "pending" ? "var(--warm)" : r.status === "error" ? "var(--bad)" : "var(--good)", flexShrink: 0 }}>
            {r.status === "pending" ? "…" : `${r.ms}ms`}
          </span>
        </div>
      ))}
    </div>
  );
}
