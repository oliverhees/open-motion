import { httpFetch } from "../http.ts";
// The OpenMotion agent. It never writes free code: it answers with patch operations
// that the core validates. Invalid answers go back to the model with the exact error (max 2 retries).
// Image wishes come as  src: "ai:<prompt>"  and are generated only after the patch is valid.

import { applyPatch, compositionDuration, describe, isWordCut, sceneTimings, sourceToComp, type Layer, type MotionSpec, type PatchOp } from "@openmotion/core";
import type { Settings } from "../settings.ts";
import { complete, extractJson, type Fetch, type Msg } from "./llm.ts";
import type { AiProgress } from "./cli.ts";
import { ensureFonts } from "../fonts.ts";
import { systemPrompt } from "./guide.ts";
import { aspectFor, generateImage } from "./images.ts";
import { renderFrames } from "../frames.ts";

export type AgentKind = "chat" | "comment" | "transcript";

export interface AgentRequest {
  kind: AgentKind;
  spec: MotionSpec;
  /** Chat history incl. the new user message last. */
  messages?: { role: "user" | "assistant"; text: string }[];
  comment?: { t: number; layer?: string; text: string };
  selection?: string | null;
  t?: number;
  maxLayers?: number;
  /** Language of the editor UI: the answer to the user is written in it. */
  lang?: "de" | "en";
}

/** missingFonts: families Google Fonts does not know; the text falls back to the system font. */
export interface AgentResult { message: string; ops: PatchOp[]; changed: string[]; images: string[]; attempts: number; missingFonts?: string[]; ask?: AskQuestion[]; review?: { scores: Record<string, number>; fixes: number } }

/** A question the AI asks back; the editor shows it as a form. */
export interface AskQuestion { id: string; q: string; options: string[]; multi?: boolean; free?: boolean }

function cleanAsk(v: unknown): AskQuestion[] | null {
  if (!Array.isArray(v) || !v.length) return null;
  const out = v.slice(0, 6).flatMap((x, i) => {
    const o = x as Record<string, unknown>;
    if (typeof o?.q !== "string" || !o.q.trim()) return [];
    const options = Array.isArray(o.options) ? o.options.filter((s): s is string => typeof s === "string" && !!s.trim()).slice(0, 8).map((s) => s.slice(0, 160)) : [];
    return [{ id: typeof o.id === "string" && o.id ? o.id.slice(0, 40) : `q${i + 1}`, q: o.q.slice(0, 300), options, multi: o.multi === true, free: o.free !== false }];
  });
  return out.length ? out : null;
}

const MAX_IMAGES = 4;

export async function runAgent(req: AgentRequest, ctx: { settings: Settings; projectDir: string; fetch?: Fetch; onProgress?: (p: AiProgress) => void }): Promise<AgentResult> {
  const f = ctx.fetch ?? httpFetch;
  const progress = ctx.onProgress ?? (() => {});
  const system = systemPrompt(req.spec, req.lang);
  const convo: Msg[] = [...history(req), { role: "user", content: `${context(req)}\n\n${task(req)}` }];
  let lastError = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    progress(attempt === 1 ? { phase: "thinking" } : { phase: "retry", n: attempt });
    const text = process.env.OPENMOTION_FAKE_AI === "1" ? fakeAnswer(req) : await complete(ctx.settings, system, convo, f, 8000, progress);
    progress({ phase: "checking" });
    let out: { message?: unknown; ops?: unknown; ask?: unknown };
    try {
      out = extractJson(text) as typeof out;
      const ask = cleanAsk(out.ask);
      if (ask && (!Array.isArray(out.ops) || out.ops.length === 0)) {
        return { message: typeof out.message === "string" ? out.message : "", ops: [], changed: [], images: [], attempts: attempt, ask };
      }
      if (!Array.isArray(out.ops)) throw new Error('Field "ops" is missing or not an array.');
      const ops = out.ops as PatchOp[];
      const check = applyPatch(req.spec, ops);
      const images = await resolveImages(ops, req.spec, ctx, f, progress);
      const missingFonts = await withFonts(ops, req.spec, ctx, f);
      const result: AgentResult = { message: typeof out.message === "string" ? out.message : "Erledigt.", ops, changed: check.changed, images, attempts: attempt, missingFonts };
      if (shouldReview(req, ctx.settings, ops)) {
        convo.push({ role: "assistant", content: text.slice(0, 40000) });
        await review(req, ctx, f, progress, system, convo, result).catch(() => {});
      }
      return result;
    } catch (e) {
      lastError = (e as Error).message;
      if (process.env.OPENMOTION_DEBUG === "1") console.error(`[agent] attempt ${attempt} rejected: ${lastError.slice(0, 1200)}`);
      if (/API-Key|antwortet mit|Kie\.ai|Gemini|OpenRouter: |Bild/.test(lastError) && !/Patch op|Invalid Motion-Spec|JSON/.test(lastError)) throw e;
      convo.push({ role: "assistant", content: text.slice(0, 20000) });
      convo.push({ role: "user", content: `Deine Antwort war ungültig:\n${lastError.slice(0, 3000)}\n\nKorrigiere sie. Antworte wieder nur mit dem JSON-Objekt {"message": …, "ops": […]}.` });
    }
  }
  throw new Error(`Die KI hat nach 3 Versuchen keine gültige Änderung geliefert. Letzter Fehler: ${lastError.slice(0, 600)}`);
}

/** Fonts the AI picked are downloaded and registered with one more op. Returns families Google does not know. */
async function withFonts(ops: PatchOp[], base: MotionSpec, ctx: { projectDir: string }, f: Fetch): Promise<string[]> {
  if (process.env.OPENMOTION_FAKE_AI === "1" || process.env.OPENMOTION_NO_FONT_DOWNLOAD === "1") return [];
  const fonts = await ensureFonts(applyPatch(base, ops).spec, ctx.projectDir, f).catch(() => null);
  if (fonts?.op) ops.push(fonts.op);
  return fonts?.missing ?? [];
}

/** Bigger builds get a look-and-fix pass (can be switched off in the settings). */
function shouldReview(req: AgentRequest, settings: Settings, ops: PatchOp[]): boolean {
  if (process.env.OPENMOTION_FAKE_AI === "1" || settings.ai.review === false) return false;
  if (req.kind === "comment") return false;
  return ops.filter((o) => o.op === "add" || o.op === "replace" || o.op === "swap").length >= 4;
}

/** Moments worth judging: the hook, then each scene once its entrances are done. */
export function reviewTimes(spec: MotionSpec): number[] {
  const d = compositionDuration(spec);
  const scenes = sceneTimings(spec);
  const ts = [Math.min(0.9, d * 0.1)];
  if (spec.scenes.length) {
    for (const s of spec.scenes.slice(0, 7)) {
      const t = scenes.get(s.id)!;
      ts.push(t.start + Math.min((t.end - t.start) * 0.6, 1.8));
    }
  } else for (let i = 1; i <= 5; i++) ts.push((d * i) / 6);
  return [...new Set(ts.map((t) => Math.round(Math.min(Math.max(t, 0), d - 0.05) * 100) / 100))].slice(0, 8);
}

/**
 * Look-and-fix: renders frames of the result, shows them to the model as images and asks for a harsh
 * scored review plus fix ops on top. Adds the fixes to `result`. Silent no-op if anything is missing
 * (no Chrome, model without image input, invalid fix): the first result still stands.
 */
const REVIEW_ROUNDS = 2;
const avg = (sc: Record<string, number>) => { const v = Object.values(sc).filter((x) => typeof x === "number"); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 10; };

async function review(req: AgentRequest, ctx: { settings: Settings; projectDir: string }, f: Fetch, progress: (p: AiProgress) => void, system: string, convo: Msg[], result: AgentResult) {
  const lang = req.lang === "en" ? "English" : "German";
  let fixes = 0;
  for (let round = 1; round <= REVIEW_ROUNDS; round++) {
    progress({ phase: "review", n: round });
    const built = applyPatch(req.spec, result.ops).spec;
    const shots = await renderFrames(built, ctx.projectDir, reviewTimes(built), 0.5);
    convo.push({
      role: "user",
      content: `REVIEW${round > 1 ? ` (round ${round}: after your fixes)` : ""}. These are frames of the video you just built, at t = ${shots.map((s) => `${s.t}s`).join(", ")} (shown half size).
Be a harsh motion director, not a proud author. Look at every frame and score 1–10: hook (0–1 s), readability at phone size, hierarchy & composition (focal points, depth, use of space, no empty half-frames), spacing (overlaps, cut-off or clipped text, safe area), typography, color & polish (style fidelity), pace & variety.
List what you actually SEE that is wrong. Then fix the worst problems with ops applied ON TOP of your previous ops (same ids; "set"/"replace"/"remove"/"add").
The user has NOT seen any earlier version: the message describes the finished video only (never mention a review, fixes or changes).
Answer only with JSON: {"message": "final reply to the user in ${lang} (2–5 sentences: what is in the video, with times like 0:05, and the idea behind it)", "scores": {"hook":0,"readability":0,"composition":0,"spacing":0,"typography":0,"polish":0,"pace":0}, "ops": [ … ]}. If every score is ≥ 8, "ops": [].`,
      images: shots.map((s) => s.png),
    });
    let done = false;
    for (let attempt = 1; attempt <= 2 && !done; attempt++) {
      const text = await complete(ctx.settings, system, convo, f, 8000, (p) => progress(p.phase === "writing" ? { ...p, phase: "review", n: round } : p));
      try {
        const out = extractJson(text) as { message?: unknown; ops?: unknown; scores?: Record<string, number> };
        const fix = Array.isArray(out.ops) ? (out.ops as PatchOp[]) : [];
        const check = applyPatch(built, fix);
        if (fix.length) {
          result.images.push(...(await resolveImages(fix, built, ctx, f, progress)));
          result.missingFonts = [...(result.missingFonts ?? []), ...(await withFonts(fix, built, ctx, f))];
          result.ops.push(...fix);
          result.changed = [...new Set([...result.changed, ...check.changed])];
          fixes += fix.length;
        }
        if (typeof out.message === "string" && out.message.trim()) result.message = out.message;
        if (out.scores && typeof out.scores === "object") result.review = { scores: out.scores, fixes };
        convo.push({ role: "assistant", content: text.slice(0, 20000) });
        done = true;
        // Good enough, or nothing left to fix: stop. Otherwise look once more at the fixed version.
        if (!fix.length || avg(out.scores ?? {}) >= 7.5) return;
      } catch (e) {
        convo.push({ role: "assistant", content: text.slice(0, 20000) });
        convo.push({ role: "user", content: `Invalid: ${(e as Error).message.slice(0, 2000)}\nAnswer again with the JSON only; fix ops must apply on top of your previous ops.` });
      }
    }
    if (!done) return;
  }
}

/** Replaces every "ai:<prompt>" src with a generated, locally saved image. */
async function resolveImages(ops: PatchOp[], spec: MotionSpec, ctx: { settings: Settings; projectDir: string }, f: Fetch, progress: (p: AiProgress) => void = () => {}): Promise<string[]> {
  const wanted: { set: (src: string, prompt: string, model: string) => void; prompt: string; w: number; h: number }[] = [];
  const frameOf = (id: string) => {
    const l = spec.layers.find((x) => x.id === id);
    return l && l.type !== "audio" ? l.frame : { w: 1600, h: 900 };
  };
  for (const op of ops) {
    const o = op as unknown as Record<string, any>;
    if (o.op === "add" && typeof o.layer?.src === "string" && o.layer.src.startsWith("ai:")) {
      wanted.push({ prompt: o.layer.src.slice(3).trim(), w: o.layer.frame?.w ?? 1600, h: o.layer.frame?.h ?? 900, set: (src, prompt, model) => { o.layer.src = src; o.layer.source = { kind: "ai", prompt, model }; } });
    } else if ((o.op === "swap" || o.op === "replace") && typeof (o.content ?? o.layer)?.src === "string" && (o.content ?? o.layer).src.startsWith("ai:")) {
      const c = o.content ?? o.layer;
      const fr = c.frame ?? frameOf(o.id);
      wanted.push({ prompt: c.src.slice(3).trim(), w: fr.w, h: fr.h, set: (src, prompt, model) => { c.src = src; c.source = { kind: "ai", prompt, model }; } });
    } else if (o.op === "set" && o.path === "src" && typeof o.value === "string" && o.value.startsWith("ai:")) {
      const fr = frameOf(o.id);
      wanted.push({ prompt: o.value.slice(3).trim(), w: fr.w, h: fr.h, set: (src) => { o.value = src; } });
    }
  }
  if (wanted.length > MAX_IMAGES) throw new Error(`Patch op: höchstens ${MAX_IMAGES} KI-Bilder pro Antwort (angefragt: ${wanted.length}).`);
  const out: string[] = [];
  for (const [i, wnt] of wanted.entries()) {
    progress({ phase: "image", n: i + 1, of: wanted.length });
    if (!wnt.prompt) throw new Error('Patch op: "ai:" ohne Bild-Prompt.');
    const img = process.env.OPENMOTION_FAKE_AI === "1"
      ? await fakeImage(ctx.projectDir)
      : await generateImage(ctx.settings, wnt.prompt, aspectFor(wnt.w, wnt.h), ctx.projectDir, f);
    wnt.set(img.path, wnt.prompt, `${img.provider}:${img.model}`);
    out.push(img.path);
  }
  return out;
}

function history(req: AgentRequest): Msg[] {
  if (req.kind !== "chat" || !req.messages?.length) return [];
  return req.messages.slice(-11, -1).map((m) => ({ role: m.role, content: m.text.slice(0, 4000) }));
}

function context(req: AgentRequest): string {
  const s = req.spec;
  const parts = [`PROJEKT\n${describe(s)}`];
  const scenes = sceneTimings(s);
  if (s.scenes.length) parts.push(`SZENEN (absolute Zeiten): ${s.scenes.map((x) => `${x.id} ${r(scenes.get(x.id)!.start)}–${r(scenes.get(x.id)!.end)}s`).join(", ")}`);
  if (s.transcript?.words.length) {
    const words = s.transcript.words.filter((w) => !isWordCut(s.transcript!, w.id)).slice(0, 900);
    parts.push(`GESAGTES (Wort-id@Sekunde im Video, geschnittene Wörter fehlen):\n${words.map((w) => `${w.id}@${r(sourceToComp(s, w.t0))} ${w.text}`).join(" ")}`);
  }
  const sel = req.kind === "comment" ? req.comment?.layer : req.selection;
  const layer = sel ? s.layers.find((l) => l.id === sel) : undefined;
  if (layer) parts.push(`AUSGEWÄHLTE EBENE (vollständig):\n${JSON.stringify(layer)}`);
  if (typeof req.t === "number") parts.push(`ABSPIELKOPF: ${r(req.t)} s`);
  return parts.join("\n\n");
}

function task(req: AgentRequest): string {
  if (req.kind === "comment") {
    const c = req.comment!;
    return `AUFGABE: Kommentar bei ${r(c.t)} s${c.layer ? ` zur Ebene "${c.layer}"` : ""}: "${c.text}"\nSetze genau das um. Ändere nur ${c.layer ? `die Ebene "${c.layer}"` : "das Nötigste"}, alles andere bleibt, wie es ist.`;
  }
  if (req.kind === "transcript") {
    return `AUFGABE: Erzeuge Motion Graphics zum Gesagten. Pro Kernaussage ein kurzer Titel oder ein Stichwort, wo es passt eine gezeichnete SVG-Grafik. Verankere jede neue Ebene per "anchor" am passenden Wort (offset ca. -0.2). Lass die Facecam frei, platziere Grafiken daneben. Höchstens ${req.maxLayers ?? 8} neue Ebenen. Lösche nichts.`;
  }
  const last = req.messages?.[req.messages.length - 1]?.text ?? "";
  return `AUFGABE (Nachricht vom Nutzer): ${last}`;
}

export { systemPrompt } from "./guide.ts";

// ---------- Test mode (OPENMOTION_FAKE_AI=1): deterministic answers, no network ----------
function fakeAnswer(req: AgentRequest): string {
  const s = req.spec;
  const taken = new Set(s.layers.map((l) => l.id));
  const id = (base: string) => { let c = base; for (let i = 2; taken.has(c); i++) c = `${base}-${i}`; return c; };
  const W = s.canvas.width, H = s.canvas.height;
  const top = Math.max(0, ...s.layers.filter((l) => l.type !== "video").map((l) => l.track));
  if (req.kind === "comment") {
    const target = req.comment?.layer && s.layers.find((l) => l.id === req.comment!.layer && l.type !== "audio");
    if (!target) return JSON.stringify({ message: "Testmodus: Kein Element am Kommentar, nichts geändert.", ops: [] });
    return JSON.stringify({ message: `Testmodus: „${target.name ?? target.id}" leicht gedreht.`, ops: [{ op: "set", id: target.id, path: "frame.rotation", value: 6 }] });
  }
  if (req.kind === "transcript") {
    const w = s.transcript?.words[Math.min(2, (s.transcript?.words.length ?? 1) - 1)];
    if (!w) return JSON.stringify({ message: "Testmodus: Kein Transkript.", ops: [] });
    return JSON.stringify({ message: "Testmodus: Ein Stichwort am Wort verankert.", ops: [{ op: "add", layer: { id: id("ki-stichwort"), name: "KI-Stichwort", type: "text", track: top + 1, start: 0, duration: 2.5, anchor: { word: w.id, offset: -0.2 }, frame: { x: 120, y: 120, w: 900, h: 140 }, text: w.text.toUpperCase(), style: { fontSize: 96, fontWeight: 800, color: "#ffffff" }, in: { type: "pop" }, out: { type: "fade" } } }] });
  }
  const msg = (req.messages?.[req.messages.length - 1]?.text ?? "Hallo").slice(0, 40);
  const ops: unknown[] = [{ op: "add", layer: { id: id("ki-text"), name: "KI-Text", type: "text", track: top + 1, start: 0, duration: 4, frame: { x: 160, y: H - 260, w: W - 320, h: 140 }, text: msg, style: { fontSize: 72, fontWeight: 800, color: "#ffffff", align: "center", valign: "middle", background: "#00000099", padding: 16, radius: 16 }, in: { type: "slideUp" }, out: { type: "fade" } } }];
  if (/bild|image/i.test(msg)) ops.push({ op: "add", layer: { id: id("ki-bild"), name: "KI-Bild", type: "image", track: top + 2, start: 0, duration: 4, frame: { x: 160, y: 120, w: 640, h: 360 }, src: "ai:test image of a mountain lake", radius: 16, in: { type: "pop" } } });
  return JSON.stringify({ message: `Testmodus: Text „${msg}" eingefügt.`, ops });
}

export async function fakeImage(projectDir: string) {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==", "base64");
  await mkdir(path.join(projectDir, "assets", "images"), { recursive: true });
  const name = `ki-test-${Date.now().toString(36)}.png`;
  await writeFile(path.join(projectDir, "assets", "images", name), png);
  return { path: `assets/images/${name}`, provider: "kie" as const, model: "fake", bytes: png.length };
}

const r = (v: number) => Math.round(v * 100) / 100;
