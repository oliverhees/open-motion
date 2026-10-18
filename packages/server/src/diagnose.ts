// "Verbindungen testen": one tiny request per configured key, plus model-name checks with suggestions.
// The report contains no keys and can be shared for debugging.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import type { MotionSpec } from "@openmotion/core";
import { httpFetch } from "./http.ts";
import { run } from "./media.ts";
import { localAvailable } from "./transcribe.ts";
import { DEFAULT_IMAGE_MODELS, DEFAULT_LLM_MODELS, type LlmProvider, type Settings } from "./settings.ts";
import { complete, type Fetch } from "./ai/llm.ts";
import { CLI_LABEL, CLI_PROVIDERS, cliVersion } from "./ai/cli.ts";
import { generateImage } from "./ai/images.ts";
import { detectHardware, planRender } from "@openmotion/render";
import { runAgent } from "./ai/agent.ts";

export interface Check { area: string; name: string; ok: boolean | null; ms: number; detail: string; hint?: string }
export interface DiagnoseOptions { images?: boolean; agent?: boolean; fetch?: Fetch; exampleSpec?: string }

export async function diagnose(settings: Settings, opts: DiagnoseOptions = {}): Promise<Check[]> {
  const f = opts.fetch ?? httpFetch;
  const out: Check[] = [];
  const add = async (area: string, name: string, fn: () => Promise<{ detail: string; hint?: string; ok?: boolean | null }>) => {
    const t0 = Date.now();
    try {
      const r = await fn();
      out.push({ area, name, ok: r.ok === undefined ? true : r.ok, ms: Date.now() - t0, detail: r.detail, hint: r.hint });
    } catch (e) {
      const msg = (e as Error).message;
      out.push({ area, name, ok: false, ms: Date.now() - t0, detail: msg.slice(0, 400), hint: hintFor(msg) });
    }
  };
  const skip = (area: string, name: string, detail = "kein Key eingetragen") => out.push({ area, name, ok: null, ms: 0, detail });

  // System tools
  await add("System", "FFmpeg", async () => ({ detail: (await run("ffmpeg", ["-version"])).split("\n")[0].slice(0, 60) }));
  await add("System", "Render-Hardware", async () => {
    const hw = await detectHardware();
    return { detail: `${planRender(hw, { height: 1080 }).reason}${hw.gpu.usable ? "" : " · GPU: keine nutzbare gefunden (CPU-Kodierung)"}` };
  });
  await add("System", "Lokales Whisper", async () => (await localAvailable() ? { detail: "faster-whisper gefunden" } : { ok: null, detail: "nicht installiert (optional): pip install faster-whisper" }));

  // Language models
  for (const p of ["anthropic", "openai", "openrouter"] as LlmProvider[]) {
    const active = settings.ai.provider === p;
    const name = `${label(p)}${active ? " (aktiv)" : ""}`;
    if (!settings.keys[p]) { (active ? out.push({ area: "KI", name, ok: false, ms: 0, detail: "aktiver Anbieter, aber kein Key eingetragen" }) : skip("KI", name)); continue; }
    const model = (active && settings.ai.model) || DEFAULT_LLM_MODELS[p];
    await add("KI", name, async () => {
      try {
        const txt = await complete({ ...settings, ai: { provider: p, model } }, 'Antworte nur mit {"ok":true}', [{ role: "user", content: "Test" }], f, 64);
        return { detail: `Modell ${model}: Antwort erhalten (${txt.trim().slice(0, 40) || "leer"})` };
      } catch (e) {
        const msg = (e as Error).message;
        if (/ 404|not_found|model|does not exist|invalid model/i.test(msg)) {
          const sug = await suggestModels(p, settings.keys[p]!, f).catch(() => []);
          return { ok: false, detail: `Modell „${model}" abgelehnt: ${msg.slice(0, 200)}`, hint: sug.length ? `Verfügbare Modelle z. B.: ${sug.join(", ")}` : "Modellnamen in ⚙ Einstellungen prüfen." };
        }
        throw e;
      }
    });
  }

  // Language models through a local CLI (subscription, no key). The test call only runs for the active one.
  for (const p of CLI_PROVIDERS) {
    const active = settings.ai.provider === p;
    const name = `${CLI_LABEL[p]}${active ? " (aktiv)" : ""}`;
    if (!active) {
      const t0 = Date.now();
      const v = await cliVersion(p).catch(() => null);
      out.push({ area: "KI", name, ok: null, ms: Date.now() - t0, detail: v ? `installiert (${v}), nicht aktiv` : "nicht installiert (optional)" });
      continue;
    }
    await add("KI", name, async () => {
      const v = await cliVersion(p);
      const txt = await complete(settings, 'Antworte nur mit {"ok":true}', [{ role: "user", content: "Test" }], f, 64);
      return { detail: `${v}${settings.ai.model ? `, Modell ${settings.ai.model}` : ""}: Antwort erhalten (${txt.trim().slice(0, 40) || "leer"})` };
    });
  }

  // Image models
  const ip = settings.images.provider;
  const imodel = settings.images.model || DEFAULT_IMAGE_MODELS[ip];
  const ikey = ip === "kie" ? settings.keys.kie : ip === "gemini" ? settings.keys.gemini : settings.keys[ip];
  if (!ikey) out.push({ area: "Bilder", name: `${label(ip)} (aktiv)`, ok: false, ms: 0, detail: "aktiver Bildanbieter, aber kein Key eingetragen" });
  else {
    await add("Bilder", `${label(ip)} (aktiv)`, async () => {
      if (ip === "kie") {
        const r = await getJson(f, "https://api.kie.ai/api/v1/chat/credit", { authorization: `Bearer ${ikey}` }) as { code?: number; data?: number; msg?: string };
        if (r.code && r.code !== 200) throw new Error(`Kie.ai: ${r.msg ?? r.code}`);
        return { detail: `Key gültig, Guthaben: ${r.data ?? "?"} Credits. Modell ${imodel} (wird erst beim Generieren geprüft)` };
      }
      if (ip === "gemini") {
        const r = await getJson(f, "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", { "x-goog-api-key": ikey }) as { models?: { name: string }[] };
        const ids = (r.models ?? []).map((m) => m.name.replace(/^models\//, ""));
        return ids.includes(imodel) ? { detail: `Key gültig, Modell ${imodel} vorhanden` } : { ok: false, detail: `Key gültig, aber Modell „${imodel}" nicht gefunden`, hint: `Bildmodelle: ${ids.filter((i) => /image/i.test(i)).slice(0, 8).join(", ") || "keine gefunden"}` };
      }
      if (ip === "openai") {
        const ids = await modelIds(f, "https://api.openai.com/v1/models", { authorization: `Bearer ${ikey}` });
        return ids.includes(imodel) ? { detail: `Key gültig, Modell ${imodel} vorhanden` } : { ok: false, detail: `Key gültig, aber Modell „${imodel}" nicht freigeschaltet`, hint: `Bildmodelle: ${ids.filter((i) => /image|dall/i.test(i)).join(", ") || "keine"}` };
      }
      const ids = await modelIds(f, "https://openrouter.ai/api/v1/models", {});
      return ids.includes(imodel) ? { detail: `Modell ${imodel} vorhanden (Key wird beim Chat-Test geprüft)` } : { ok: false, detail: `Modell „${imodel}" bei OpenRouter nicht gefunden`, hint: `z. B.: ${ids.filter((i) => /image/i.test(i)).slice(0, 6).join(", ")}` };
    });
    if (opts.images) {
      await add("Bilder", "Echte Testgenerierung", async () => {
        const dir = await mkdtemp(path.join(os.tmpdir(), "om-diag-"));
        try {
          const img = await generateImage(settings, "A small red circle on a white background, flat illustration", "1:1", dir, f);
          return { detail: `Bild erzeugt (${Math.round(img.bytes / 1024)} KB) mit ${img.provider}:${img.model}` };
        } finally { await rm(dir, { recursive: true, force: true }); }
      });
    }
  }

  // Transcription keys
  const stt: [string, string | undefined, string, Record<string, string>][] = [
    ["Groq", settings.keys.groq, "https://api.groq.com/openai/v1/models", { authorization: `Bearer ${settings.keys.groq}` }],
    ["Deepgram", settings.keys.deepgram, "https://api.deepgram.com/v1/projects", { authorization: `Token ${settings.keys.deepgram}` }],
    ["ElevenLabs", settings.keys.elevenlabs, "https://api.elevenlabs.io/v1/models", { "xi-api-key": settings.keys.elevenlabs ?? "" }],
  ];
  for (const [name, key, url, headers] of stt) {
    if (!key) { skip("Transkript", name); continue; }
    await add("Transkript", name, async () => { await getJson(f, url, headers); return { detail: "Key gültig" }; });
  }
  if (settings.transcription.provider !== "local" && !settings.keys[settings.transcription.provider]) {
    out.push({ area: "Transkript", name: `Aktiver Anbieter: ${settings.transcription.provider}`, ok: false, ms: 0, detail: "kein Key eingetragen" });
  }

  // Full agent round trip on the example (costs a few cents)
  if (opts.agent && opts.exampleSpec) {
    await add("KI", "Agent-Probelauf (Beispielprojekt)", async () => {
      const spec = JSON.parse(readFileSync(opts.exampleSpec!, "utf8")) as MotionSpec;
      const dir = await mkdtemp(path.join(os.tmpdir(), "om-diag-"));
      try {
        const r = await runAgent({ kind: "chat", spec, messages: [{ role: "user", text: "Mach den Titel der ersten Szene orange ($accent)." }] }, { settings, projectDir: dir, fetch: f });
        return { detail: `${r.ops.length} gültige Änderung(en) nach ${r.attempts} Versuch(en): ${r.message.slice(0, 120)}` };
      } finally { await rm(dir, { recursive: true, force: true }); }
    });
  }
  return out;
}

export function formatReport(checks: Check[], settings: Settings): string {
  const icon = (c: Check) => (c.ok === null ? "–" : c.ok ? "✓" : "✗");
  const keys = Object.entries(settings.keys).filter(([, v]) => v).map(([k, v]) => `${k} …${v!.slice(-4)}`).join(", ") || "keine";
  return [
    `OpenMotion Verbindungstest · ${new Date().toISOString()} · Node ${process.version} · ${os.platform()}`,
    `KI: ${settings.ai.provider} ${settings.ai.model || "(Standard)"} · Bilder: ${settings.images.provider} ${settings.images.model || "(Standard)"} · Transkript: ${settings.transcription.provider}`,
    `Keys: ${keys}`,
    "",
    ...checks.map((c) => `${icon(c)} [${c.area}] ${c.name} (${c.ms} ms): ${c.detail}${c.hint ? `\n    → ${c.hint}` : ""}`),
  ].join("\n");
}

async function suggestModels(p: LlmProvider, key: string, f: Fetch): Promise<string[]> {
  if (p === "anthropic") return (await modelIds(f, "https://api.anthropic.com/v1/models?limit=50", { "x-api-key": key, "anthropic-version": "2023-06-01" })).slice(0, 8);
  if (p === "openai") return (await modelIds(f, "https://api.openai.com/v1/models", { authorization: `Bearer ${key}` })).filter((i) => /^gpt-|^o\d/.test(i)).sort().reverse().slice(0, 10);
  return (await modelIds(f, "https://openrouter.ai/api/v1/models", {})).filter((i) => i.startsWith("anthropic/") || i.startsWith("openai/")).slice(0, 10);
}

async function modelIds(f: Fetch, url: string, headers: Record<string, string>): Promise<string[]> {
  const j = await getJson(f, url, headers) as { data?: { id: string }[] };
  return (j.data ?? []).map((m) => m.id);
}

async function getJson(f: Fetch, url: string, headers: Record<string, string>): Promise<unknown> {
  const r = await f(url, { headers, signal: AbortSignal.timeout(30_000) });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 200)}`);
  return JSON.parse(t);
}

function hintFor(msg: string): string | undefined {
  if (/nicht gefunden\. Installieren/.test(msg)) return "CLI installieren und einmal anmelden, dann Open Motion ohne Docker starten (npm start).";
  if (/\(Abo\)/.test(msg)) return /→/.test(msg) ? undefined : "Im Terminal prüfen, ob die CLI angemeldet ist und eine Antwort gibt.";
  if (/ 401|unauthori|invalid.*key|authentication|permission/i.test(msg)) return "Key ungültig oder ohne Berechtigung. Neu erstellen und eintragen.";
  if (/ 402|credit|balance|quota|billing|insufficient/i.test(msg)) return "Kein Guthaben oder Limit erreicht. Konto beim Anbieter aufladen.";
  if (/ 429|rate/i.test(msg)) return "Zu viele Anfragen. Kurz warten und erneut testen.";
  if (/ENOTFOUND|ECONNREFUSED|fetch failed|NETZWERK|timeout/i.test(msg)) return "Keine Verbindung. Internet/Firewall/Proxy des Servers prüfen.";
  return undefined;
}

const label = (p: string) => ({ anthropic: "Anthropic (Claude)", openai: "OpenAI", openrouter: "OpenRouter", kie: "Kie.ai", gemini: "Google Gemini" } as Record<string, string>)[p] ?? p;
