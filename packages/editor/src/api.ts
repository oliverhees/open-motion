import type { Brand, MotionSpec } from "@openmotion/core";

export interface ProjectInfo { id: string; title: string; createdAt: string; updatedAt: string; duration?: number }
export interface Comment { id: string; t: number; layer?: string; x?: number; y?: number; text: string; toAI: boolean; status: "open" | "queued" | "done"; createdAt: string; reply?: string }
export interface Integrations { images: boolean; imageProvider: string; kieCredits: number | null; mcps: { tool: string; name: string }[]; kieMcp: { tool: string; name: string }[] }
/** A question the AI asks back; shown as a form in the chat. */
export interface AskQuestion { id: string; q: string; options: string[]; multi?: boolean; free?: boolean }
export interface ChatEntry {
  id: string; role: "user" | "assistant" | "error"; text: string; at: string; changed?: string[]; images?: string[]; ops?: number; undone?: boolean;
  ask?: AskQuestion[]; answered?: boolean; review?: { score: number; fixes: number };
}
export interface AgentResult {
  message: string; ops: import("@openmotion/core").PatchOp[]; changed: string[]; images: string[]; attempts: number;
  ask?: AskQuestion[]; missingFonts?: string[]; review?: { scores: Record<string, number>; fixes: number };
}
export interface Asset { path: string; kind: "images" | "video" | "audio" | "fonts"; size: number; duration?: number; width?: number; height?: number; hasAudio?: boolean }
export interface UploadResult extends Asset { converted: boolean; hasVideo: boolean }
export type Provider = "local" | "openai" | "elevenlabs" | "groq" | "deepgram";
export type LlmProvider = "anthropic" | "openai" | "openrouter" | "claude-code" | "codex";
export type ImageProvider = "kie" | "openai" | "openrouter" | "gemini";
export type BrandInput = Partial<Omit<Brand, "id" | "logo" | "logoAspect">>;
export interface PublicSettings { transcription: { provider: Provider; language: string; models: Partial<Record<Provider, string>> }; ai: { provider: LlmProvider; model?: string; review?: boolean }; images: { provider: ImageProvider; model?: string }; keys: Record<string, { set: boolean; hint?: string }>; brand?: string }
export interface Task<T = unknown> { id: string; status: "queued" | "running" | "done" | "error"; result?: T; error?: string; startedAt?: number; progress?: AiProgress }
/** Live state of the AI while it works (from the server, translated in the chat). */
export interface AiProgress { phase: "thinking" | "writing" | "checking" | "retry" | "image" | "review"; text?: string; ops?: number; n?: number; of?: number }
export interface TranscriptResult { source: string; language?: string; provider: string; words: { id: string; text: string; t0: number; t1: number }[] }
export interface ExportRequest { format: "mp4" | "gif" | "webm" | "mov" | "lottie"; height: number; fps: number; quality: "high" | "medium" | "low"; sharpText: boolean; transparent?: boolean; hide?: string[] }
export interface RenderPlan { workers: number; gpu: boolean; reason: string; info?: { cores: number; container: boolean; memGB: number; load: number; limit: "cpu" | "ram" | "cap" | "forced"; gpuName?: string } }
export interface Estimate { frames: number; seconds: number; calibrated: boolean; plan: RenderPlan }
export interface Job { id: string; status: "queued" | "running" | "done" | "error"; estimateSeconds: number; plan?: RenderPlan; workerOnline?: boolean; startedAt?: number; finishedAt?: number; file?: string; size?: number; error?: string; warnings?: { code: string; layers: string[] }[] }

/** Every request carries x-om: 1 (CSRF protection). A 401 sends the app back to the login screen. */
async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers as Record<string, string> | undefined), "x-om": "1" } });
  const body = await r.json().catch(() => ({}));
  if (r.status === 401 && !url.startsWith("/api/auth/")) window.dispatchEvent(new Event("om-auth"));
  if (!r.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${r.status}`);
  return body as T;
}

export const api = {
  list: () => req<ProjectInfo[]>("/api/projects"),
  create: (title: string, template: "blank" | "example", lang?: string, format?: string, style?: string, brand?: string | null) => req<ProjectInfo>("/api/projects", { method: "POST", body: JSON.stringify({ title, template, lang, format, style, brand }) }),
  brands: () => req<{ brands: Brand[]; default: string | null }>("/api/brands"),
  createBrand: (b: BrandInput) => req<Brand>("/api/brands", { method: "POST", body: JSON.stringify(b) }),
  updateBrand: (id: string, b: BrandInput) => req<Brand>(`/api/brands/${id}`, { method: "PUT", body: JSON.stringify(b) }),
  deleteBrand: (id: string) => req<{ ok: true }>(`/api/brands/${id}`, { method: "DELETE" }),
  brandLogo: (id: string, file: File) => req<Brand>(`/api/brands/${id}/logo`, { method: "POST", body: file, headers: { "content-type": file.type || "application/octet-stream" } }),
  brandFont: (id: string, slot: "display" | "body", file: File, family: string) =>
    req<Brand>(`/api/brands/${id}/font?slot=${slot}&name=${encodeURIComponent(file.name)}&family=${encodeURIComponent(family)}`, { method: "POST", body: file, headers: { "content-type": "application/octet-stream" } }),
  brandLogoUrl: (b: Brand) => `/api/brands/${b.id}/logo?v=${encodeURIComponent(b.logo ?? "")}`,
  brandFontUrl: (b: Brand, slot: "display" | "body") => `/api/brands/${b.id}/font/${slot}?v=${encodeURIComponent(b.fonts[slot]?.file ?? "")}`,
  applyBrand: (id: string, brand: string | null) => req<{ spec: MotionSpec; missingFonts: string[] }>(`/api/projects/${id}/brand`, { method: "POST", body: JSON.stringify({ brand }) }),
  /** Voice → text (local Whisper or the configured service). */
  dictate: (audio: Blob, lang: string) => req<Task<{ text: string }>>(`/api/dictate?lang=${encodeURIComponent(lang)}`, { method: "POST", body: audio, headers: { "content-type": audio.type || "audio/webm" } }),
  integrations: () => req<Integrations>("/api/integrations"),
  fontUrl: (family: string) => `/api/fontfile/${encodeURIComponent(family)}`,
  read: (id: string) => req<{ project: ProjectInfo; spec: MotionSpec; comments: Comment[] }>(`/api/projects/${id}`),
  rev: (id: string) => req<{ updatedAt: string }>(`/api/projects/${id}/rev`),
  saveSpec: (id: string, spec: MotionSpec) => req<{ warnings: string[]; updatedAt: string }>(`/api/projects/${id}/spec`, { method: "PUT", body: JSON.stringify(spec) }),
  saveComments: (id: string, comments: Comment[]) => req<{ ok: true }>(`/api/projects/${id}/comments`, { method: "PUT", body: JSON.stringify(comments) }),
  assets: (id: string) => req<Asset[]>(`/api/projects/${id}/assets`),
  exportStart: (id: string, body: ExportRequest) => req<Job>(`/api/projects/${id}/export`, { method: "POST", body: JSON.stringify(body) }),
  job: (jobId: string) => req<Job>(`/api/jobs/${jobId}`),
  estimate: (id: string, body: ExportRequest) => req<Estimate>(`/api/projects/${id}/estimate`, { method: "POST", body: JSON.stringify(body) }),
  me: () => req<{ required: boolean; authenticated: boolean; via: string | null }>("/api/auth/me"),
  login: (password: string) => req<{ ok: true }>("/api/auth/login", { method: "POST", body: JSON.stringify({ password }) }),
  logout: () => req<{ ok: true }>("/api/auth/logout", { method: "POST" }),
  tokens: () => req<{ id: string; name: string; prefix: string; createdAt: string; lastUsed?: string }[]>("/api/tokens"),
  createToken: (name: string) => req<{ token: string; info: { id: string; name: string; prefix: string } }>("/api/tokens", { method: "POST", body: JSON.stringify({ name }) }),
  revokeToken: (id: string) => req<{ ok: true }>(`/api/tokens/${id}`, { method: "DELETE" }),
  settings: () => req<PublicSettings>("/api/settings"),
  saveSettings: (patch: unknown) => req<PublicSettings>("/api/settings", { method: "PUT", body: JSON.stringify(patch) }),
  capabilities: () => req<{ localWhisper: boolean; keys: Record<string, boolean> }>("/api/capabilities"),
  transcribe: (id: string, body: { source: string; provider?: Provider; language?: string }) => req<Task<TranscriptResult>>(`/api/projects/${id}/transcribe`, { method: "POST", body: JSON.stringify(body) }),
  task: <T,>(taskId: string) => req<Task<T>>(`/api/tasks/${taskId}`),
  diagnose: (body: { images: boolean; agent: boolean }) => req<Task<{ checks: { area: string; name: string; ok: boolean | null; ms: number; detail: string; hint?: string }[]; report: string }>>("/api/diagnose", { method: "POST", body: JSON.stringify(body) }),
  chat: (id: string) => req<ChatEntry[]>(`/api/projects/${id}/chat`),
  saveChat: (id: string, list: ChatEntry[]) => req<{ ok: true }>(`/api/projects/${id}/chat`, { method: "PUT", body: JSON.stringify(list) }),
  ai: (id: string, body: unknown) => req<Task<AgentResult>>(`/api/projects/${id}/ai`, { method: "POST", body: JSON.stringify(body) }),
  aiImage: (id: string, body: { prompt: string; w: number; h: number }) => req<Task<{ path: string; provider: string; model: string }>>(`/api/projects/${id}/ai/image`, { method: "POST", body: JSON.stringify(body) }),
  /** Polls a background task until it is done; throws its error. */
  wait: async <T,>(task: Task<T>, onTick?: (t: Task<T>) => void): Promise<T> => {
    let t = task;
    while (t.status === "queued" || t.status === "running") {
      await new Promise((r) => setTimeout(r, 1000));
      t = await req<Task<T>>(`/api/tasks/${t.id}`);
      onTick?.(t);
    }
    if (t.status === "error" || t.result === undefined) throw new Error(t.error ?? "Aufgabe fehlgeschlagen");
    return t.result;
  },
  /** Upload with progress (XHR, fetch has no upload progress). */
  upload: (id: string, file: Blob, name: string, onProgress?: (p: number) => void) =>
    new Promise<UploadResult>((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open("POST", `/api/projects/${id}/upload?name=${encodeURIComponent(name)}`);
      x.setRequestHeader("x-om", "1");
      x.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100));
      x.onload = () => {
        const body = JSON.parse(x.responseText || "{}");
        if (x.status >= 200 && x.status < 300) resolve(body as UploadResult);
        else reject(new Error(body.error ?? `HTTP ${x.status}`));
      };
      x.onerror = () => reject(new Error("Upload abgebrochen"));
      x.send(file);
    }),
};

export const fmtTime = (t: number) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
};
