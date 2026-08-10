/**
 * Groq client — voice/TTS provider + voice-model catalogue.
 * LLM reasoning now lives in lib/chat.ts (NVIDIA heavy models).
 */
import Groq from "groq-sdk";
import { getDb } from "./db";

let client: Groq | null = null;
export function groq(): Groq {
  if (!client) {
    const key = process.env.GROQ_API_KEY;
    if (!key) throw new Error("GROQ_API_KEY not set");
    client = new Groq({ apiKey: key });
  }
  return client;
}

export function logTts(model: string, latencyMs: number, chars: number, voice: string) {
  try {
    getDb()
      .prepare("INSERT INTO analytics_events (kind, model, latency_ms, meta, created_at) VALUES ('tts_call',?,?,?,?)")
      .run(model, latencyMs, JSON.stringify({ chars, voice }), Date.now());
  } catch { /* non-fatal */ }
}
