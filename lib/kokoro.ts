import crypto from "crypto";
import { trackModelApi } from "./bus";
/**
 * Kokoro local TTS client.
 * Calls the Python kokoro_server.py running on localhost:8880.
 * Drop-in replacement for the Groq audio.speech API — returns a raw WAV Buffer.
 *
 * Start the server before running the Next.js app:
 *   source /home/abeer/Downloads/git/.venv/bin/activate.fish
 *   python scripts/kokoro_server.py
 */

const KOKORO_BASE = process.env.KOKORO_URL ?? "http://127.0.0.1:8880";

/** Voice IDs understood by the local Kokoro server (Kokoro naming convention). */
export type KokoroVoice = string;

export interface KokoroTTSRequest {
  text: string;
  voice: KokoroVoice;
  speed?: number;
}

/**
 * Send one text chunk to the local Kokoro server and get WAV bytes back.
 * Throws if the server is unreachable or returns a non-200 status.
 */
export async function kokoroTTS(req: KokoroTTSRequest): Promise<Buffer> {
  const { text, voice, speed = 1.0 } = req;

  let res: Response;
  const apiId = `kokoro_${crypto.randomBytes(4).toString("hex")}`;
  trackModelApi(apiId, `Kokoro TTS (${voice})`, "pending");
  const start = Date.now();
  try {
    res = await fetch(`${KOKORO_BASE}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice, speed }),
      // No streaming — kokoro_server returns the whole WAV at once
      signal: AbortSignal.timeout(120_000),
    });
  } catch (e) {
    trackModelApi(apiId, `Kokoro TTS (${voice})`, "error");
    throw new Error(
      `Kokoro server unreachable at ${KOKORO_BASE} — is scripts/kokoro_server.py running? (${e})`
    );
  }

  if (!res.ok) {
    let detail = "";
    try {
      const j = (await res.json()) as { error?: string };
      detail = j.error ?? "";
    } catch { /* ignore */ }
    trackModelApi(apiId, `Kokoro TTS (${voice})`, "error");
    throw new Error(`Kokoro TTS error ${res.status}: ${detail}`);
  }

  trackModelApi(apiId, `Kokoro TTS (${voice})`, "resolved", Date.now() - start);
  return Buffer.from(await res.arrayBuffer());
}

/** Simple health-check — resolves true if the server is up. */
export async function kokoroHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${KOKORO_BASE}/health`, {
      signal: AbortSignal.timeout(3_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
