// In-memory event bus for live log/SSE streaming of pipeline events.
import { EventEmitter } from "events";

const g = globalThis as unknown as { __newscastBus?: EventEmitter };
export function bus(): EventEmitter {
  if (!g.__newscastBus) {
    g.__newscastBus = new EventEmitter();
    g.__newscastBus.setMaxListeners(100);
  }
  return g.__newscastBus;
}

export interface BusEvent {
  type: string;
  message: string;
  meta?: unknown;
  at: number;
}

export function logEvent(type: string, message: string, meta?: unknown) {
  bus().emit("event", { type, message, meta, at: Date.now() } satisfies BusEvent);
}

export function episodeProgress(episodeId: string, status: string, progress: number, stageLabel: string, extra?: unknown) {
  bus().emit("episode", { episodeId, status, progress, stageLabel, extra, at: Date.now() });
}

export function trackModelApi(id: string, name: string, status: "pending" | "resolved" | "error", ms?: number) {
  bus().emit("model_api", { id, name, status, ms, at: Date.now() });
}
