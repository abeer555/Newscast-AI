import Groq from "groq-sdk";
import crypto from "crypto";
import { getDb } from "./db";
import { LLM } from "./sources";

let client: Groq | null = null;
export function groq(): Groq {
  if (!client) {
    const key = process.env.GROQ_API_KEY;
    if (!key) throw new Error("GROQ_API_KEY not set");
    client = new Groq({ apiKey: key });
  }
  return client;
}

/** In-flight + recent-result cache keyed on prompt+model+schema — dedupes identical LLM calls. */
const callCache = new Map<string, Promise<unknown>>();

export function cacheKey(parts: unknown[]): string {
  return crypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function logAnalytics(kind: string, model: string, latencyMs: number, usage?: { prompt_tokens?: number; completion_tokens?: number }, meta?: unknown) {
  try {
    getDb()
      .prepare("INSERT INTO analytics_events (kind, model, tokens_prompt, tokens_completion, latency_ms, meta, created_at) VALUES (?,?,?,?,?,?,?)")
      .run(kind, model, usage?.prompt_tokens ?? 0, usage?.completion_tokens ?? 0, latencyMs, meta ? JSON.stringify(meta) : null, Date.now());
  } catch { /* non-fatal */ }
}

export interface ChatOpts {
  model?: string;
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  /** Structured output schema (json_schema strict mode, gpt-oss-120b) */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  /** JSON object mode fallback */
  jsonObject?: boolean;
  cacheTtlMs?: number;
}

export async function chat(opts: ChatOpts): Promise<{ content: string; model: string; cached: boolean; latencyMs: number }> {
  const model = opts.model ?? LLM.structured;
  const key = cacheKey([model, opts.system, opts.user, opts.jsonSchema ?? null, opts.temperature ?? 0.6, opts.maxTokens ?? 2048]);
  const inflight = callCache.get(key);
  if (inflight) {
    const res = (await inflight) as { content: string; model: string; latencyMs: number };
    return { ...res, cached: true };
  }

  const p = (async () => {
    const start = Date.now();
    const params: Record<string, unknown> = {
      model,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
      temperature: opts.temperature ?? 0.6,
      max_completion_tokens: opts.maxTokens ?? 4096,
    };
    if (opts.jsonSchema) {
      params.response_format = {
        type: "json_schema",
        json_schema: { name: opts.jsonSchema.name, strict: true, schema: opts.jsonSchema.schema },
      };
    } else if (opts.jsonObject) {
      params.response_format = { type: "json_object" };
    }

    let resp;
    try {
      resp = await groq().chat.completions.create(params as never);
    } catch (e: unknown) {
      // Fallback: structured model → general model with json_object mode
      if (opts.jsonSchema && model !== LLM.general) {
        // json_object mode requires the literal word "json" in a message
        (params.messages as { role: string; content: string }[])[1].content += "\n\nRespond with a single valid JSON object only.";
        const fb = { ...params, model: LLM.general, response_format: { type: "json_object" } as const };
        const retry = await groq().chat.completions.create(fb as never);
        const latencyMs = Date.now() - start;
        logAnalytics("llm_call", LLM.general, latencyMs, retry.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined, { fallback: true, schema: opts.jsonSchema.name });
        return { content: retry.choices[0]?.message?.content ?? "", model: LLM.general, latencyMs };
      }
      logAnalytics("error", model, Date.now() - start, undefined, { message: String(e) });
      throw e;
    }
    const latencyMs = Date.now() - start;
    logAnalytics("llm_call", model, latencyMs, resp.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined, { schema: opts.jsonSchema?.name });
    return { content: resp.choices[0]?.message?.content ?? "", model, latencyMs };
  })();

  callCache.set(key, p);
  try {
    const res = await p;
    // keep resolved value in cache briefly for dedupe of repeat requests
    const resolved = Promise.resolve(res);
    callCache.set(key, resolved);
    setTimeout(() => {
      if (callCache.get(key) === resolved) callCache.delete(key);
    }, opts.cacheTtlMs ?? 10 * 60 * 1000).unref?.();
    return { ...res, cached: false };
  } catch (e) {
    callCache.delete(key);
    throw e;
  }
}

/** Parse JSON robustly, tolerating markdown fences. */
export function parseJson<T>(raw: string): T {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const start = s.search(/[[{]/);
  const end = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  return JSON.parse(s) as T;
}

export async function chatJson<T>(opts: ChatOpts): Promise<{ data: T; model: string; cached: boolean; latencyMs: number; raw: string }> {
  const first = await chat(opts);
  try {
    return { data: parseJson<T>(first.content), model: first.model, cached: first.cached, latencyMs: first.latencyMs, raw: first.content };
  } catch {
    // repair pass: one retry with explicit instruction
    const repair = await chat({
      ...opts,
      model: LLM.general,
      jsonSchema: undefined,
      jsonObject: true,
      user: opts.user + "\n\nIMPORTANT: respond with ONLY a valid JSON object. No prose, no markdown.",
      temperature: 0.2,
    });
    return { data: parseJson<T>(repair.content), model: repair.model, cached: repair.cached, latencyMs: first.latencyMs + repair.latencyMs, raw: repair.content };
  }
}
