import type { MotionSpec } from "@openmotion/core";

export interface ProjectInfo { id: string; title: string; createdAt: string; updatedAt: string; duration?: number }
export interface Comment { id: string; t: number; layer?: string; x?: number; y?: number; text: string; toAI: boolean; status: "open" | "queued" | "done"; createdAt: string; reply?: string }
export interface ChatEntry { id: string; role: "user" | "assistant" | "error"; text: string; at: string; changed?: string[]; images?: string[]; ops?: number; undone?: boolean }
export interface AgentResult { message: string; ops: import("@openmotion/core").PatchOp[]; changed: string[]; images: string[]; attempts: number }
export interface Asset { path: string; kind: "images" | "video" | "audio" | "fonts"; size: number; duration?: number; width?: number; height?: number; hasAudio?: boolean }
export interface UploadResult extends Asset { converted: boolean; hasVideo: boolean }
export type Provider = "local" | "openai" | "elevenlabs" | "groq" | "deepgram";
export type LlmProvider = "anthropic" | "openai" | "openrouter" | "claude-code" | "codex";
export type ImageProvider = "kie" | "openai" | "openrouter" | "gemini";
export interface PublicSettings { transcription: { provider: Provider; language: string; models: Partial<Record<Provider, string>> }; ai: { provider: LlmProvider; model?: string }; images: { provider: ImageProvider; model?: string }; keys: Record<string, { set: boolean; hint?: string }> }
export interface Task<T = unknown> { id: string; status: "queued" | "running" | "done" | "error"; result?: T; error?: string; startedAt?: number }
export interface TranscriptResult { source: string; language?: string; provider: string; words: { id: string; text: string; t0: number; t1: number }[] }
export interface ExportRequest { format: "mp4" | "gif"; height: number; fps: number; quality: "high" | "medium" | "low"; sharpText: boolean }
export interface RenderPlan { workers: number; gpu: boolean; reason: string; info?: { cores: number; container: boolean; memGB: number; load: number; limit: "cpu" | "ram" | "cap" | "forced"; gpuName?: string } }
export interface Estimate { frames: number; seconds: number; calibrated: boolean; plan: RenderPlan }
export interface Job { id: string; status: "queued" | "running" | "done" | "error"; estimateSeconds: number; plan?: RenderPlan; workerOnline?: boolean; startedAt?: number; finishedAt?: number; file?: string; size?: number; error?: string }

/** Every request carries x-om: 1 (CSRF protection). A 401 sends the app back to the login screen. */
async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { "content-type": "application/json", "x-om": "1" } });
  const body = await r.json().catch(() => ({}));
  if (r.status === 401 && !url.startsWith("/api/auth/")) window.dispatchEvent(new Event("om-auth"));
  if (!r.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${r.status}`);
  return body as T;
}

export const api = {
  list: () => req<ProjectInfo[]>("/api/projects"),
  create: (title: string, template: "blank" | "example", lang?: string) => req<ProjectInfo>("/api/projects", { method: "POST", body: JSON.stringify({ title, template, lang }) }),
  read: (id: string) => req<{ project: ProjectInfo; spec: MotionSpec; comments: Comment[] }>(`/api/projects/${id}`),
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
  wait: async <T,>(task: Task<T>, onTick?: () => void): Promise<T> => {
    let t = task;
    while (t.status === "queued" || t.status === "running") {
      await new Promise((r) => setTimeout(r, 1000));
      onTick?.();
      t = await req<Task<T>>(`/api/tasks/${t.id}`);
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
