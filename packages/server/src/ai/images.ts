import { httpFetch } from "../http.ts";
// Image models: Kie.ai (async jobs), OpenAI, OpenRouter, Google Gemini. Result is always saved locally.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { DEFAULT_IMAGE_MODELS, type ImageProvider, type Settings } from "../settings.ts";
import type { Fetch } from "./llm.ts";

export interface ImageResult { path: string; provider: ImageProvider; model: string; bytes: number }
const LABEL: Record<ImageProvider, string> = { kie: "Kie.ai", openai: "OpenAI", openrouter: "OpenRouter", gemini: "Google Gemini" };

/** Nearest supported aspect ratio for a frame. */
export function aspectFor(w: number, h: number): "1:1" | "16:9" | "9:16" | "4:3" | "3:4" {
  const r = w / h;
  const opts: [string, number][] = [["1:1", 1], ["16:9", 16 / 9], ["9:16", 9 / 16], ["4:3", 4 / 3], ["3:4", 3 / 4]];
  return opts.reduce((a, b) => (Math.abs(Math.log(b[1] / r)) < Math.abs(Math.log(a[1] / r)) ? b : a))[0] as "16:9";
}

export async function generateImage(settings: Settings, prompt: string, aspect: string, projectDir: string, f: Fetch = httpFetch, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<ImageResult> {
  const provider = settings.images.provider;
  const model = settings.images.model || DEFAULT_IMAGE_MODELS[provider];
  const key = provider === "kie" ? settings.keys.kie : provider === "gemini" ? settings.keys.gemini : settings.keys[provider];
  if (!key) throw new Error(`Kein API-Key für ${LABEL[provider]} (Bilder). Trag ihn unter ⚙ Einstellungen ein.`);
  let data: Buffer;
  let ext = "png";

  if (provider === "kie") {
    const created = await json(f, "https://api.kie.ai/api/v1/jobs/createTask", { authorization: `Bearer ${key}` }, { model, input: { prompt, aspect_ratio: aspect } }, provider) as { code?: number; msg?: string; data?: { taskId?: string } };
    const taskId = created.data?.taskId;
    if (!taskId || (created.code && created.code !== 200)) throw new Error(`Kie.ai: ${created.msg ?? "kein taskId"}`);
    let url: string | undefined;
    for (let i = 0, delay = 2000; i < 120; i++, delay = Math.min(delay * 1.25, 10000)) {
      const r = await f(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, { headers: { authorization: `Bearer ${key}` } });
      const j = await r.json() as { data?: { state?: string; resultJson?: string | { resultUrls?: string[] }; failMsg?: string } };
      const st = j.data?.state;
      if (st === "fail") throw new Error(`Kie.ai: ${j.data?.failMsg ?? "Generierung fehlgeschlagen"}`);
      if (st === "success") {
        const rj = typeof j.data!.resultJson === "string" ? JSON.parse(j.data!.resultJson) : j.data!.resultJson;
        url = rj?.resultUrls?.[0];
        break;
      }
      await sleep(delay);
    }
    if (!url) throw new Error("Kie.ai: kein Ergebnis (Zeitüberschreitung)");
    const img = await f(url);
    if (!img.ok) throw new Error(`Kie.ai: Download fehlgeschlagen (${img.status})`);
    data = Buffer.from(await img.arrayBuffer());
    ext = /\.(jpe?g|webp)(\?|$)/i.exec(url)?.[1]?.replace("jpeg", "jpg") ?? "png";
  } else if (provider === "openai") {
    const size = aspect === "1:1" ? "1024x1024" : aspect === "9:16" || aspect === "3:4" ? "1024x1536" : "1536x1024";
    const j = await json(f, "https://api.openai.com/v1/images/generations", { authorization: `Bearer ${key}` }, { model, prompt, size, n: 1 }, provider) as { data?: { b64_json?: string; url?: string }[] };
    data = await fromB64OrUrl(f, j.data?.[0]?.b64_json, j.data?.[0]?.url);
  } else if (provider === "openrouter") {
    const j = await json(f, "https://openrouter.ai/api/v1/chat/completions", { authorization: `Bearer ${key}`, "X-Title": "OpenMotion" },
      { model, messages: [{ role: "user", content: prompt }], modalities: ["image", "text"], image_config: { aspect_ratio: aspect } }, provider);
    data = parseDataUrl(fromOpenRouter(j));
  } else {
    const j = await json(f, `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { "x-goog-api-key": key },
      { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: aspect } } }, provider);
    const inline = fromGemini(j);
    data = Buffer.from(inline.data, "base64");
    ext = inline.mimeType.includes("jpeg") ? "jpg" : "png";
  }

  const dir = path.join(projectDir, "assets", "images");
  await mkdir(dir, { recursive: true });
  const name = `ki-${slug(prompt)}-${randomBytes(2).toString("hex")}.${ext}`;
  await writeFile(path.join(dir, name), data);
  return { path: `assets/images/${name}`, provider, model, bytes: data.length };
}

export function fromOpenRouter(j: unknown): string {
  const url = (j as { choices?: { message?: { images?: { image_url?: { url?: string } }[] } }[] }).choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!url) throw new Error("OpenRouter: Antwort enthält kein Bild (Modell unterstützt evtl. keine Bildausgabe)");
  return url;
}

export function fromGemini(j: unknown): { data: string; mimeType: string } {
  const parts = (j as { candidates?: { content?: { parts?: { inlineData?: { data: string; mimeType: string }; inline_data?: { data: string; mime_type: string } }[] } }[] }).candidates?.[0]?.content?.parts ?? [];
  for (const p of parts) {
    if (p.inlineData?.data) return p.inlineData;
    if (p.inline_data?.data) return { data: p.inline_data.data, mimeType: p.inline_data.mime_type };
  }
  throw new Error("Gemini: Antwort enthält kein Bild");
}

function parseDataUrl(u: string): Buffer {
  const m = /^data:[^;]+;base64,(.+)$/.exec(u);
  if (!m) throw new Error("Bild-URL ist keine data:-URL");
  return Buffer.from(m[1], "base64");
}

async function fromB64OrUrl(f: Fetch, b64?: string, url?: string): Promise<Buffer> {
  if (b64) return Buffer.from(b64, "base64");
  if (url) return Buffer.from(await (await f(url)).arrayBuffer());
  throw new Error("Antwort enthält kein Bild");
}

async function json(f: Fetch, url: string, headers: Record<string, string>, body: unknown, provider: ImageProvider): Promise<unknown> {
  const r = await f(url, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(5 * 60_000) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${LABEL[provider]} antwortet mit ${r.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "bild";
