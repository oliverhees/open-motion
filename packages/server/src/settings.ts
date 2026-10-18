// Server-side settings incl. API keys (data/settings.json, file mode 600).
// Keys go IN through the editor but never come back OUT: the browser only sees "set ✓ …abcd".

import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const PROVIDERS = ["local", "openai", "elevenlabs", "groq", "deepgram"] as const;
export type Provider = (typeof PROVIDERS)[number];
export const KEY_NAMES = ["openai", "elevenlabs", "groq", "deepgram", "anthropic", "openrouter", "gemini", "kie"] as const;
export const LLM_PROVIDERS = ["anthropic", "openai", "openrouter", "claude-code", "codex", "opencode"] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];
export const IMAGE_PROVIDERS = ["kie", "openai", "openrouter", "gemini"] as const;
export type ImageProvider = (typeof IMAGE_PROVIDERS)[number];
/** CLI providers ("claude-code", "codex", "opencode") use your subscription/login; empty model = the CLI's own default. */
export const DEFAULT_LLM_MODELS: Record<LlmProvider, string> = { anthropic: "claude-sonnet-5-5", openai: "gpt-5", openrouter: "anthropic/claude-sonnet-5.5", "claude-code": "", codex: "", opencode: "" };
export const DEFAULT_IMAGE_MODELS: Record<ImageProvider, string> = { kie: "gpt-image-2-text-to-image", openai: "gpt-image-1", openrouter: "google/gemini-2.5-flash-image", gemini: "gemini-2.5-flash-image" };
export type KeyName = (typeof KEY_NAMES)[number];

export const DEFAULT_MODELS: Record<Provider, string> = {
  local: "small",
  openai: "whisper-1",
  elevenlabs: "scribe_v1",
  groq: "whisper-large-v3-turbo",
  deepgram: "nova-3",
};

export interface Settings {
  transcription: { provider: Provider; language: string; models: Partial<Record<Provider, string>> };
  /** review: look-and-fix pass after bigger builds (default on). */
  ai: { provider: LlmProvider; model?: string; review?: boolean };
  images: { provider: ImageProvider; model?: string };
  keys: Partial<Record<KeyName, string>>;
  /** Default brand for new projects (brand id). */
  brand?: string;
}

export interface PublicSettings {
  transcription: Settings["transcription"];
  ai: Settings["ai"];
  images: Settings["images"];
  keys: Record<KeyName, { set: boolean; hint?: string }>;
  brand?: string;
}

const DEFAULTS: Settings = { transcription: { provider: "local", language: "auto", models: {} }, ai: { provider: "anthropic" }, images: { provider: "kie" }, keys: {} };

export class SettingsStore {
  readonly file: string;
  constructor(dataDir: string) {
    this.file = path.resolve(dataDir, "settings.json");
  }

  async read(): Promise<Settings> {
    if (!existsSync(this.file)) return structuredClone(DEFAULTS);
    const raw = JSON.parse(await readFile(this.file, "utf8")) as Partial<Settings>;
    return {
      transcription: { ...DEFAULTS.transcription, ...(raw.transcription ?? {}), models: { ...(raw.transcription?.models ?? {}) } },
      ai: { ...DEFAULTS.ai, ...(raw.ai ?? {}) },
      images: { ...DEFAULTS.images, ...(raw.images ?? {}) },
      keys: { ...(raw.keys ?? {}) },
      ...(typeof raw.brand === "string" ? { brand: raw.brand } : {}),
    };
  }

  async readPublic(): Promise<PublicSettings> {
    return toPublic(await this.read());
  }

  /** Keys: a non-empty string sets it, "" or null deletes it, a missing field leaves it alone. */
  async update(patch: { transcription?: Partial<Settings["transcription"]>; ai?: Partial<Settings["ai"]>; images?: Partial<Settings["images"]>; keys?: Partial<Record<KeyName, string | null>>; brand?: string | null }): Promise<PublicSettings> {
    const cur = await this.read();
    if (patch.transcription) {
      const t = patch.transcription;
      if (t.provider && PROVIDERS.includes(t.provider)) cur.transcription.provider = t.provider;
      if (typeof t.language === "string") cur.transcription.language = t.language.slice(0, 12);
      if (t.models) for (const p of PROVIDERS) if (typeof t.models[p] === "string") cur.transcription.models[p] = t.models[p]!.slice(0, 80);
    }
    if (patch.ai?.provider && LLM_PROVIDERS.includes(patch.ai.provider)) cur.ai.provider = patch.ai.provider;
    if (patch.ai && typeof patch.ai.model === "string") cur.ai.model = patch.ai.model.slice(0, 120) || undefined;
    if (patch.ai && typeof patch.ai.review === "boolean") cur.ai.review = patch.ai.review;
    if (patch.images?.provider && IMAGE_PROVIDERS.includes(patch.images.provider)) cur.images.provider = patch.images.provider;
    if (patch.images && typeof patch.images.model === "string") cur.images.model = patch.images.model.slice(0, 120) || undefined;
    if (patch.brand === null || patch.brand === "") delete cur.brand;
    else if (typeof patch.brand === "string" && /^[a-z0-9][a-z0-9-]{0,60}$/.test(patch.brand)) cur.brand = patch.brand;
    for (const k of KEY_NAMES) {
      if (!patch.keys || !(k in patch.keys)) continue;
      const v = patch.keys[k];
      if (typeof v === "string" && v.trim()) cur.keys[k] = v.trim();
      else delete cur.keys[k];
    }
    await mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(cur, null, 2), { mode: 0o600 });
    await rename(tmp, this.file);
    await chmod(this.file, 0o600);
    return toPublic(cur);
  }
}

function toPublic(s: Settings): PublicSettings {
  const keys = {} as PublicSettings["keys"];
  for (const k of KEY_NAMES) {
    const v = s.keys[k];
    keys[k] = v ? { set: true, hint: v.length > 8 ? `…${v.slice(-4)}` : "…" } : { set: false };
  }
  return { transcription: s.transcription, ai: s.ai, images: s.images, keys, ...(s.brand ? { brand: s.brand } : {}) };
}
