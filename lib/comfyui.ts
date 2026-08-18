import fs from "fs";
import path from "path";
import crypto from "crypto";
import { getDb } from "./db";
import { trackModelApi } from "./bus";

/**
 * ComfyUI client for the locally-hosted Z-Image-Turbo workflow (see Z-image.json).
 * Submits edited copies of the workflow, polls /history, downloads results.
 */

const COMFY_URL = process.env.COMFYUI_URL ?? "http://127.0.0.1:8188";
const WORKFLOW_PATH = path.join(process.cwd(), "Z-image.json");
const FRAMES_DIR = path.join(process.cwd(), "data", "frames");

let workflowTemplate: Record<string, { inputs: Record<string, unknown>; class_type: string }> | null = null;

function loadWorkflow() {
  if (!workflowTemplate) {
    workflowTemplate = JSON.parse(fs.readFileSync(WORKFLOW_PATH, "utf8"));
  }
  return workflowTemplate;
}

export async function comfyAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${COMFY_URL}/system_stats`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

export interface GenImageOpts {
  prompt: string;
  negative?: string;
  width?: number;
  height?: number;
  seed?: number;
  steps?: number;
  timeoutMs?: number;
}

/** Node IDs inside Z-image.json */
const NODE = { saveImage: "9", clip: "62", vae: "63", decode: "65", unet: "66", positivePrompt: "67", latent: "68", sampler: "70", negativePrompt: "71" };

export async function generateImage(opts: GenImageOpts): Promise<{ filePath: string; latencyMs: number }> {
  const wf = JSON.parse(JSON.stringify(loadWorkflow()));
  wf[NODE.positivePrompt].inputs.text = opts.prompt;
  if (opts.negative) wf[NODE.negativePrompt].inputs.text = opts.negative;
  wf[NODE.latent].inputs.width = opts.width ?? 1280;
  wf[NODE.latent].inputs.height = opts.height ?? 720;
  wf[NODE.sampler].inputs.seed = opts.seed ?? Math.floor(Math.random() * 2 ** 32);
  wf[NODE.sampler].inputs.steps = opts.steps ?? 8;
  wf[NODE.saveImage].inputs.filename_prefix = "newscast";

  const start = Date.now();
  const apiId = `zimg_${crypto.randomBytes(4).toString("hex")}`;
  trackModelApi(apiId, "Z-Image-Turbo", "pending");

  let submit: Response;
  try {
    submit = await fetch(`${COMFY_URL}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: wf }),
    });
    if (!submit.ok) throw new Error(`ComfyUI submit failed: HTTP ${submit.status}`);
  } catch (e) {
    trackModelApi(apiId, "Z-Image-Turbo", "error");
    throw e;
  }
  
  const { prompt_id } = (await submit.json()) as { prompt_id: string };

  const timeout = opts.timeoutMs ?? 180_000;
  const deadline = start + timeout;
  let filename: string | null = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    const hist = await fetch(`${COMFY_URL}/history/${prompt_id}`);
    if (!hist.ok) continue;
    const data = await hist.json();
    const job = data[prompt_id];
    if (!job) continue;
    if (job.status?.status_str === "error") {
      trackModelApi(apiId, "Z-Image-Turbo", "error");
      throw new Error(`ComfyUI job error: ${JSON.stringify(job.status).slice(0, 200)}`);
    }
    const imgs = job.outputs?.[NODE.saveImage]?.images;
    if (imgs?.length) { filename = imgs[0].filename; break; }
  }
  if (!filename) {
    trackModelApi(apiId, "Z-Image-Turbo", "error");
    throw new Error(`ComfyUI timed out after ${timeout}ms`);
  }

  const imgRes = await fetch(`${COMFY_URL}/view?filename=${encodeURIComponent(filename)}&type=output`);
  if (!imgRes.ok) throw new Error(`Failed to fetch image ${filename}`);
  const buf = Buffer.from(await imgRes.arrayBuffer());
  try {
    if (!fs.existsSync(FRAMES_DIR)) fs.mkdirSync(FRAMES_DIR, { recursive: true });
  } catch (e) {
    // Read-only filesystem - skip frame generation
  }
  const out = path.join(FRAMES_DIR, filename.replace(/^newscast/, `nc_${Date.now()}_${Math.floor(Math.random() * 999)}`));
  fs.writeFileSync(out, buf);
  const latencyMs = Date.now() - start;
  trackModelApi(apiId, "Z-Image-Turbo", "resolved", latencyMs);
  try { getDb().prepare("INSERT INTO analytics_events (kind, model, latency_ms, meta, created_at) VALUES ('image_gen','z-image-turbo',?,?,?)").run(latencyMs, JSON.stringify({ chars: opts.prompt.length }), Date.now()); } catch { /* */ }
  return { filePath: out, latencyMs };
}
