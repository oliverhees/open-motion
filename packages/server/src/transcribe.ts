import { httpFetch } from "./http.ts";
// Transcription with word timestamps: local (faster-whisper) or OpenAI, ElevenLabs Scribe, Groq, Deepgram.
// All results are normalized to [{ text, t0, t1 }] in seconds of the SOURCE file.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { run, speechAudio } from "./media.ts";
import { DEFAULT_MODELS, type Provider, type Settings } from "./settings.ts";

export interface RawWord { text: string; t0: number; t1: number }
export interface TranscribeResult { words: RawWord[]; language?: string; provider: Provider; model: string }
export interface TranscribeOptions { provider?: Provider; language?: string; model?: string; modelsDir: string }

const PY = path.resolve(import.meta.dirname, "../py/transcribe.py");

export async function transcribe(file: string, settings: Settings, opts: TranscribeOptions): Promise<TranscribeResult> {
  const provider = opts.provider ?? settings.transcription.provider;
  const model = opts.model || settings.transcription.models[provider] || DEFAULT_MODELS[provider];
  const language = (opts.language ?? settings.transcription.language ?? "de").trim() || "auto";
  if (provider === "local") return { ...(await local(file, model, language, opts.modelsDir)), provider, model };

  const key = settings.keys[provider];
  if (!key) throw new Error(`Kein API-Key für ${label(provider)}. Trag ihn unter Einstellungen ein.`);
  const work = await mkdtemp(path.join(os.tmpdir(), "om-stt-"));
  try {
    const mp3 = path.join(work, "speech.mp3");
    await speechAudio(file, mp3);
    const audio = await readFile(mp3);
    const lang = language === "auto" ? undefined : language;
    let words: RawWord[];
    if (provider === "openai" || provider === "groq") {
      const url = provider === "openai" ? "https://api.openai.com/v1/audio/transcriptions" : "https://api.groq.com/openai/v1/audio/transcriptions";
      const form = new FormData();
      form.append("file", new Blob([audio], { type: "audio/mpeg" }), "speech.mp3");
      form.append("model", model);
      form.append("response_format", "verbose_json");
      form.append("timestamp_granularities[]", "word");
      if (lang) form.append("language", lang);
      words = fromOpenAI(await call(url, { method: "POST", headers: { authorization: `Bearer ${key}` }, body: form }, provider));
    } else if (provider === "elevenlabs") {
      const form = new FormData();
      form.append("file", new Blob([audio], { type: "audio/mpeg" }), "speech.mp3");
      form.append("model_id", model);
      form.append("timestamps_granularity", "word");
      if (lang) form.append("language_code", lang);
      words = fromElevenLabs(await call("https://api.elevenlabs.io/v1/speech-to-text", { method: "POST", headers: { "xi-api-key": key }, body: form }, provider));
    } else {
      const q = new URLSearchParams({ model, smart_format: "true", punctuate: "true", ...(lang ? { language: lang } : { detect_language: "true" }) });
      words = fromDeepgram(await call(`https://api.deepgram.com/v1/listen?${q}`, { method: "POST", headers: { authorization: `Token ${key}`, "content-type": "audio/mpeg" }, body: audio }, provider));
    }
    return { words, language: lang, provider, model };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function local(file: string, model: string, language: string, modelsDir: string): Promise<{ words: RawWord[]; language?: string }> {
  let out: string;
  try {
    out = await run("python3", [PY, file, model, language, modelsDir], { HF_HUB_DISABLE_TELEMETRY: "1" });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes("nicht installiert") || msg.includes("exited with 3")) {
      throw new Error("Lokales Whisper fehlt: pip install faster-whisper. Oder wähle unter Einstellungen einen API-Anbieter.");
    }
    if (msg.includes("ENOENT")) throw new Error("Python 3 wurde nicht gefunden. Installiere Python 3 oder wähle einen API-Anbieter.");
    throw e;
  }
  const j = JSON.parse(out.trim().split("\n").pop()!) as { words?: RawWord[]; language?: string; error?: string };
  if (j.error) throw new Error(j.error);
  return { words: j.words ?? [], language: j.language };
}

async function call(url: string, init: RequestInit, provider: Provider): Promise<unknown> {
  const r = await httpFetch(url, { ...init, signal: AbortSignal.timeout(15 * 60_000) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${label(provider)} antwortet mit ${r.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

const label = (p: Provider) => ({ local: "Lokales Whisper", openai: "OpenAI", elevenlabs: "ElevenLabs", groq: "Groq", deepgram: "Deepgram" })[p];

const clean = (w: RawWord[]) =>
  w.map((x) => ({ text: x.text.trim(), t0: r3(x.t0), t1: r3(Math.max(x.t0, x.t1)) })).filter((x) => x.text && Number.isFinite(x.t0));
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** OpenAI and Groq: verbose_json with words[]. */
export function fromOpenAI(j: unknown): RawWord[] {
  const words = (j as { words?: { word: string; start: number; end: number }[] }).words ?? [];
  return clean(words.map((w) => ({ text: w.word, t0: w.start, t1: w.end })));
}

/** ElevenLabs Scribe: words[] contains words, spacing and audio events. */
export function fromElevenLabs(j: unknown): RawWord[] {
  const words = (j as { words?: { text: string; start: number; end: number; type?: string }[] }).words ?? [];
  return clean(words.filter((w) => (w.type ?? "word") === "word").map((w) => ({ text: w.text, t0: w.start, t1: w.end })));
}

/** Deepgram: results.channels[0].alternatives[0].words[]. */
export function fromDeepgram(j: unknown): RawWord[] {
  const alt = (j as { results?: { channels?: { alternatives?: { words?: { word: string; punctuated_word?: string; start: number; end: number }[] }[] }[] } })
    .results?.channels?.[0]?.alternatives?.[0];
  return clean((alt?.words ?? []).map((w) => ({ text: w.punctuated_word ?? w.word, t0: w.start, t1: w.end })));
}

/** Word ids get a fresh prefix per run, so old anchors are re-mapped by time instead of silently jumping. */
export function withIds(words: RawWord[]): { id: string; text: string; t0: number; t1: number }[] {
  const run = randomBytes(2).toString("hex");
  return words.map((w, i) => ({ id: `w${run}-${i + 1}`, ...w }));
}

export async function localAvailable(): Promise<boolean> {
  try {
    await run("python3", ["-c", "import faster_whisper"]);
    return true;
  } catch {
    return false;
  }
}
