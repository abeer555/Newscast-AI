"use client";
import { useEffect, useRef, useSyncExternalStore } from "react";

/* ------- tiny global store (no dependency) ------- */
interface Toast { id: number; msg: string; kind: "good" | "bad" | "info"; }
interface EpisodeProgress { episodeId: string; status: string; progress: number; stageLabel: string; }
interface Stats { articles: number; clusters: number; episodes: number; episodes_ready: number; sources: number; audio_minutes: number; plays: number; }

interface State {
  toasts: Toast[];
  ingestLog: string[];
  stats: Stats | null;
  episodeProgress: Record<string, EpisodeProgress>;
  apiRequests: { id: string; url: string; status: "pending" | "resolved" | "error"; ms?: number; ts: number }[];
}

let state: State = { toasts: [], ingestLog: [], stats: null, episodeProgress: {}, apiRequests: [] };
const listeners = new Set<() => void>();
let toastId = 1;

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export const store = {
  get: () => state,
  subscribe(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn); },
  pushToast(msg: string, kind: Toast["kind"] = "info") {
    const t = { id: toastId++, msg, kind };
    set({ toasts: [...state.toasts, t] });
    setTimeout(() => store.dismissToast(t.id), 6000);
  },
  dismissToast(id: number) { set({ toasts: state.toasts.filter((t) => t.id !== id) }); },
  appendLog(line: string) { set({ ingestLog: [line, ...state.ingestLog].slice(0, 40) }); },
  updateEpisodeProgress(p: EpisodeProgress) { set({ episodeProgress: { ...state.episodeProgress, [p.episodeId]: p } }); },
  trackApiStart(id: string, url: string) {
    set({ apiRequests: [{ id, url, status: "pending", ts: Date.now() } as const, ...state.apiRequests.filter(r => r.id !== id)].slice(0, 100) });
  },
  trackApiEnd(id: string, status: "resolved" | "error") {
    set({
      apiRequests: state.apiRequests.map((r) =>
        r.id === id ? { ...r, status, ms: Date.now() - r.ts } : r
      ),
    });
  },
  async refreshStats() {
    try {
      const r = await fetch("/api/analytics");
      const j = await r.json();
      set({ stats: j.counts });
    } catch { /* ignore */ }
  },
};

export function useStore<T>(selector: (s: State & typeof actions) => T): T {
  const snap = useSyncExternalStore(store.subscribe, store.get, store.get);
  return selector({ ...snap, ...actions });
}
useStore.getState = () => ({ ...state, ...actions });
const actions = {
  refreshStats: store.refreshStats,
  appendLog: store.appendLog,
  pushToast: store.pushToast,
  dismissToast: store.dismissToast,
  updateEpisodeProgress: store.updateEpisodeProgress,
  trackApiStart: store.trackApiStart,
  trackApiEnd: store.trackApiEnd,
};

/* ------- api helper ------- */
export async function api<T = unknown>(url: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
  if (!r.ok) {
    let msg = `${r.status}`;
    try { msg = (await r.json()).error ?? msg; } catch { /* */ }
    throw new Error(msg);
  }
  return r.json() as Promise<T>;
}

/* ------- polling hook ------- */
export function useInterval(fn: () => void, ms: number | null) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (ms == null) return;
    const t = setInterval(() => ref.current(), ms);
    return () => clearInterval(t);
  }, [ms]);
}

export function timeAgo(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function fmtDuration(sec?: number | null): string {
  if (!sec) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
