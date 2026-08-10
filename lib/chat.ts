import OpenAI from "openai";
import crypto from "crypto";
import { getDb } from "./db";

/** Multi-provider LLM router — NVIDIA NIM heavy models for reasoning, Groq for TTS voices. */

export const LLM_MODELS = {
  frontier: "nvidia/nemotron-3-ultra-550b-a55b",
  heavy: "nvidia/nemotron-3-super-120b-a12b",
  groqStructured: "openai/gpt-oss-120b",
  groqGeneral: "llama-3.3-70b-versatile",
} as const;

export interface ChatCallOpts {
  model?: string;
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  jsonObject?: boolean;
  jsonSchema?: unknown; // passed through as prompt guidance; NVIDIA free endpoints do not enforce schemas
  task?: string;
}
const clients: Record<string, OpenAI> = {};
export function nvidia(): OpenAI {
  const key = process.env.NVIDIA_api ?? process.env.NVIDIA_API_KEY;
  if (!key) throw new Error("NVIDIA_api key missing in .env");
  // Nemotron Ultra 550B can take 60-120s on a long prompt; allow up to 5 min before aborting.
  if (!clients.nvidia) clients.nvidia = new OpenAI({
    baseURL: "https://integrate.api.nvidia.com/v1",
    apiKey: key,
    timeout: 300_000,
    maxRetries: 1, // never auto-retry on timeouts — those queries take minutes
  });
  return clients.nvidia;
}
export function groqSdk(): OpenAI {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY missing");
  if (!clients.groq) clients.groq = new OpenAI({ baseURL: "https://api.groq.com/openai/v1", apiKey: key, timeout: 90_000, maxRetries: 1 });
  return clients.groq;
}

const callCache = new Map<string, Promise<{ content: string; model: string; latencyMs: number }>>();
function keyOf(o: ChatCallOpts) { return crypto.createHash("sha256").update(JSON.stringify([o.model, o.system, o.user, o.temperature, o.maxTokens, o.jsonObject])).digest("hex"); }

function logLatency(kind: string, model: string, latencyMs: number, meta?: unknown) {
  try { getDb().prepare("INSERT INTO analytics_events (kind, model, latency_ms, meta, created_at) VALUES (?,?,?,?,?)").run(kind, model, latencyMs, meta ? JSON.stringify(meta) : null, Date.now()); } catch { /* ignore */ }
}

export async function chat(opts: ChatCallOpts): Promise<{ content: string; model: string; cached: boolean; latencyMs: number }> {
  const model = opts.model ?? LLM_MODELS.frontier;
  const key = keyOf(opts);
  const inflight = callCache.get(key);
  if (inflight) { const r = await inflight; return { ...r, cached: true }; }

  const run = (async () => {
    const userContent = opts.jsonObject
      ? `${opts.user}\n\nRespond with ONLY a single valid JSON object matching this shape: ${JSON.stringify((opts.jsonSchema as { schema?: { properties?: Record<string, unknown> } } | undefined)?.schema?.properties ? Object.keys((opts.jsonSchema as { schema: { properties: Record<string, unknown> } }).schema.properties) : "the requested object")}. No prose, no markdown fences.`
      : opts.user;
    const messages = [
      { role: "system" as const, content: opts.system },
      { role: "user" as const, content: userContent },
    ];
    const start = Date.now();
    let content = "";
    let usedModel = model;
    try {
      const thinking = /nemotron-3-(ultra|super)/i.test(model)
        ? ({ chat_template_kwargs: { enable_thinking: false } } as Record<string, unknown>)
        : {};
      const resp = await nvidia().chat.completions.create(
        {
          model,
          messages,
          temperature: opts.temperature ?? 0.5,
          max_tokens: opts.maxTokens ?? 7000,
          ...(opts.jsonObject ? { response_format: { type: "json_object" as const } } : {}),
          ...thinking,
        } as never,
      );
      content = (resp.choices?.[0]?.message?.content ?? "").trim();
      void resp.usage;
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      logLatency("llm_error", model, Date.now() - start, { error: msg.slice(0, 200) });
      // fallback to Groq general model if NVIDIA is unreachable
      usedModel = LLM_MODELS.groqGeneral;
      const resp = await groqSdk().chat.completions.create({
        model: usedModel, messages, temperature: opts.temperature ?? 0.5, max_completion_tokens: opts.maxTokens ?? 7000,
        ...(opts.jsonObject ? { response_format: { type: "json_object" as const } } : {}),
      } as never);
      content = (resp.choices?.[0]?.message?.content ?? "").trim();
    }
    const latencyMs = Date.now() - start;
    content = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    logLatency("llm_call", usedModel, latencyMs, { task: opts.task });
    return { content, model: usedModel, latencyMs };
  })();

  callCache.set(key, run);
  try {
    const r = await run;
    const resolved = Promise.resolve(r);
    callCache.set(key, resolved);
    setTimeout(() => { if (callCache.get(key) === resolved) callCache.delete(key); }, 10 * 60_000).unref?.();
    return { ...r, cached: false };
  } catch (e) { callCache.delete(key); throw e; }
}

export function extractJson<T>(raw: string): T {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("No JSON object in model output: " + raw.slice(0, 120));
  // balanced-brace slice to tolerate trailing prose
  let depth = 0, endIdx = start;
  for (let i = start; i <= end; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}") { depth--; if (depth === 0) { endIdx = i; break; } }
  }
  return JSON.parse(s.slice(start, endIdx + 1)) as T;
}

export async function chatJson<T>(opts: ChatCallOpts): Promise<{ data: T; model: string; cached: boolean; latencyMs: number; raw: string }> {
  const first = await chat({ ...opts, jsonObject: true });
  try {
    return { data: extractJson<T>(first.content), model: first.model, cached: first.cached, latencyMs: first.latencyMs, raw: first.content };
  } catch {
    const repair = await chat({ ...opts, model: LLM_MODELS.heavy, temperature: 0.1, jsonObject: true, user: `${opts.user}\n\nCRITICAL: previous reply was not valid JSON. Output ONLY the JSON object.` });
    return { data: extractJson<T>(repair.content), model: repair.model, cached: false, latencyMs: first.latencyMs + repair.latencyMs, raw: repair.content };
  }
}
