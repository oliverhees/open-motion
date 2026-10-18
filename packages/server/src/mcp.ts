// MCP server (Model Context Protocol) at POST /mcp. Claude Code, Codex, Hermes and other agents
// build and edit videos through it, with their own subscription. The editor shows every change live.
//
// Transport: Streamable HTTP, answers as plain JSON (no SSE stream needed). For clients that only
// speak stdio there is a small bridge: mcp-stdio.ts.
// Access: API token (Bearer) from the editor. Without a password (local use) also without token,
// but then only from localhost (protects against websites and DNS rebinding).
// Rule 1 holds here too: the spec only changes through applyPatch.

import type http from "node:http";
import { createReadStream, existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  applyPatch, compositionDuration, describe, facecamLayers, findSuggestions, isWordCut, sceneTimings, sourceToComp,
  type FacecamLayout, type MotionSpec, type PatchOp,
} from "@openmotion/core";
import { estimate } from "@openmotion/render";
import type { ServerContext } from "./server.ts";
import { HttpError } from "./store.ts";
import { kindOf, probe, receiveUpload } from "./media.ts";
import { sanitize, type ExportRequest } from "./jobs.ts";
import { PROVIDERS, type Provider } from "./settings.ts";
import { systemPrompt } from "./ai/agent.ts";

const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const VERSION = "0.1.0";
const LAYOUTS: FacecamLayout[] = ["right", "corner", "circle", "split", "full"];
const SPEC_DOC = path.resolve(import.meta.dirname, "../../../docs/motion-spec.md");

const INSTRUCTIONS = `Open Motion: motion graphics as code. A video is a Motion-Spec (JSON) with scenes and layers.
Typical flow for an explainer from an existing facecam recording:
1. create_project (or list_projects) → 2. import_media with the file path of the recording → 3. add_facecam
→ 4. transcribe, then job_status until done (the transcript is saved into the project automatically)
→ 5. get_transcript: cut filler words and pauses with apply_patch ({"op":"cuts"} or {"op":"cut"}), times are SOURCE times of the recording
→ 6. add titles/graphics with apply_patch, anchored to words ("anchor": {"word": "<id>", "offset": -0.2}) → 7. export_video, job_status.
Read spec_reference once before writing patches. Every change shows up live in the editor (editor_url).`;

interface Tool { name: string; description: string; inputSchema: Record<string, unknown>; run: (a: any, c: Ctx) => Promise<unknown> }
interface Ctx extends ServerContext { baseUrl: string }

const project = { type: "string", description: "Project id from list_projects or create_project" };
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });

const TOOLS: Tool[] = [
  {
    name: "list_projects",
    description: "List all projects (id, title, duration in seconds, last change).",
    inputSchema: obj({}),
    run: async (_a, c) => (await c.store.list()).map((p) => ({ ...p, editor_url: editorUrl(c, p.id) })),
  },
  {
    name: "create_project",
    description: "Create a new project. template \"blank\" (default) or \"example\" (explainer with facecam). lang \"de\" or \"en\" sets the language of texts the AI writes.",
    inputSchema: obj({ title: { type: "string" }, template: { type: "string", enum: ["blank", "example"] }, lang: { type: "string", enum: ["de", "en"] } }, ["title"]),
    run: async (a, c) => {
      const info = await c.store.create(String(a.title ?? ""), a.template === "example" ? "example" : "blank", a.lang === "en" ? "en" : "de");
      return { ...info, editor_url: editorUrl(c, info.id) };
    },
  },
  {
    name: "get_project",
    description: "Overview of a project: all layers and scenes in readable form, transcript status, media files. Start here before changing anything.",
    inputSchema: obj({ project }, ["project"]),
    run: async (a, c) => {
      const { spec } = await c.store.read(a.project);
      const tr = spec.transcript;
      const scenes = sceneTimings(spec);
      return [
        `EDITOR: ${editorUrl(c, a.project)}`,
        describe(spec),
        spec.scenes.length ? `SCENES (absolute times): ${spec.scenes.map((s) => `${s.id} ${r(scenes.get(s.id)!.start)}–${r(scenes.get(s.id)!.end)}s`).join(", ")}` : "SCENES: none",
        tr ? `TRANSCRIPT: ${tr.words.length} words from ${tr.source}, ${tr.cuts?.length ?? 0} cuts. Details: get_transcript` : "TRANSCRIPT: none yet (transcribe)",
        `MEDIA:\n${(await c.store.assets(a.project)).map(assetLine).join("\n") || "none (import_media)"}`,
      ].join("\n\n");
    },
  },
  {
    name: "get_spec",
    description: "The complete Motion-Spec as JSON. Use it when you need exact values (frames, keys, styles) of layers.",
    inputSchema: obj({ project }, ["project"]),
    run: async (a, c) => (await c.store.read(a.project)).spec,
  },
  {
    name: "spec_reference",
    description: "Reference: layer types, fields, animations, eases and all patch operations. Read once before using apply_patch.",
    inputSchema: obj({ project: { ...project, description: "Optional: adds canvas size and palette of this project" } }),
    run: async (a, c) => {
      const spec = a.project ? (await c.store.read(a.project)).spec : undefined;
      const rules = systemPrompt(spec ?? ({ meta: { lang: "de" }, canvas: { width: 1920, height: 1080, fps: 30 }, scenes: [], layers: [] } as unknown as MotionSpec));
      const fromRules = rules.slice(rules.indexOf("REGELN"));
      const doc = existsSync(SPEC_DOC) ? readFileSync(SPEC_DOC, "utf8") : "";
      return `${fromRules}\n\nTEXT-SCHNITT (Transkript)\n{"op":"cut","t0":1.2,"t1":1.6,"reason":"filler"}  {"op":"uncut","t0":…,"t1":…}  {"op":"cuts","set":[…]} (ersetzt alle)\n{"op":"word","id":"w12","text":"korrigiert"}\nZeiten von Schnitten und Wörtern sind Zeiten in der ORIGINAL-Aufnahme.\n\n${doc}`;
    },
  },
  {
    name: "apply_patch",
    description: "Change the project with patch operations (see spec_reference). All ops are checked together; if one is invalid nothing is saved and the error says what to fix. The editor updates live.",
    inputSchema: obj({ project, ops: { type: "array", items: { type: "object" }, description: "Patch operations, e.g. [{\"op\":\"set\",\"id\":\"title\",\"path\":\"style.color\",\"value\":\"$accent\"}]" } }, ["project", "ops"]),
    run: async (a, c) => {
      if (!Array.isArray(a.ops) || !a.ops.length) throw new Error('"ops" must be a non-empty array of patch operations.');
      return save(c, a.project, a.ops as PatchOp[]);
    },
  },
  {
    name: "import_media",
    description: "Copy a media file from this computer into the project (video, audio, image, font). Videos are converted to H.264 MP4 if needed, which can take a while for long recordings. Returns the asset path for add_facecam or layers.",
    inputSchema: obj({ project, path: { type: "string", description: "Absolute path of the file on the computer running Open Motion" } }, ["project", "path"]),
    run: async (a, c) => {
      const file = importable(String(a.path ?? ""));
      const r = await receiveUpload(createReadStream(file) as unknown as http.IncomingMessage, c.store.dir(a.project), path.basename(file));
      return { ...r, hint: r.kind === "video" ? `Next: add_facecam with asset "${r.path}"` : undefined };
    },
  },
  {
    name: "add_facecam",
    description: "Put an imported video on the stage as facecam: a muted video layer plus its sound as a separate audio layer (needed for text cuts). layout: right (default, large right), corner, circle, split, full.",
    inputSchema: obj({ project, asset: { type: "string", description: "Asset path, e.g. assets/video/facecam.mp4" }, layout: { type: "string", enum: LAYOUTS } }, ["project", "asset"]),
    run: async (a, c) => {
      const dir = c.store.dir(a.project);
      const asset = String(a.asset ?? "");
      const file = path.resolve(dir, asset);
      if (!asset.startsWith("assets/video/") || !file.startsWith(path.join(dir, "assets") + path.sep) || !existsSync(file)) throw new Error(`No video "${asset}" in this project. Use import_media first, or get_project to see the media paths.`);
      const info = await probe(file);
      const { spec } = await c.store.read(a.project);
      const taken = new Set(spec.layers.map((l) => l.id));
      const top = Math.max(0, ...spec.layers.map((l) => l.track));
      const layout = LAYOUTS.includes(a.layout) ? a.layout as FacecamLayout : "right";
      const [v, au] = facecamLayers({ id: unique("facecam", taken), src: asset, duration: info.duration ?? 10, canvas: spec.canvas, layout, start: 0, track: Math.min(990, top + 10) });
      au.id = unique(`${v.id}-audio`, taken);
      v.in = { type: "fade", duration: 0.5 };
      const ops: PatchOp[] = [{ op: "add", layer: v }, ...(info.hasAudio ? [{ op: "add" as const, layer: au }] : [])];
      const out = await save(c, a.project, ops);
      return { ...out, video_layer: v.id, audio_layer: info.hasAudio ? au.id : null, duration: info.duration, hint: "Next: transcribe" };
    },
  },
  {
    name: "transcribe",
    description: "Start a transcription with word times (runs in the background). Without source the facecam video is used. provider: local (faster-whisper, free) or openai/elevenlabs/groq/deepgram (needs a key in the editor settings). Then call job_status; when done, the transcript is saved into the project.",
    inputSchema: obj({ project, source: { type: "string" }, provider: { type: "string", enum: [...PROVIDERS] }, language: { type: "string", description: "e.g. de, en or auto" } }, ["project"]),
    run: async (a, c) => {
      const dir = c.store.dir(a.project);
      const { spec } = await c.store.read(a.project);
      const source = String(a.source ?? spec.layers.find((l) => l.type === "video" && l.source?.kind === "recording")?.src ?? (await c.store.assets(a.project)).find((x) => x.kind === "video")?.path ?? "");
      const file = path.resolve(dir, source);
      if (!source || !file.startsWith(path.join(dir, "assets") + path.sep) || !existsSync(file)) throw new Error("No source found. Pass source as an asset path under assets/ (see get_project).");
      const s = await c.settings.read();
      const provider = (PROVIDERS.includes(a.provider) ? a.provider : s.transcription.provider) as Provider;
      const job = await c.queue.enqueue("transcribe", { projectId: a.project, source, provider, language: a.language || s.transcription.language }, { projectId: a.project });
      return { job: job.id, status: job.status, source, provider, hint: "Call job_status with wait_seconds until status is done." };
    },
  },
  {
    name: "job_status",
    description: "Status of a transcription or export job. wait_seconds (max 50) waits on the server until the job is finished. A finished transcription is saved into the project automatically; a finished export returns the download link.",
    inputSchema: obj({ job: { type: "string" }, wait_seconds: { type: "number" } }, ["job"]),
    run: async (a, c) => {
      const id = String(a.job ?? "");
      if (!/^[a-f0-9]{10}$/.test(id)) throw new Error(`Unknown job id "${id}".`);
      const until = Date.now() + Math.min(50, Math.max(0, Number(a.wait_seconds) || 0)) * 1000;
      let job = await c.queue.get(id);
      while (job && (job.status === "queued" || job.status === "running") && Date.now() < until) {
        await new Promise((res) => setTimeout(res, 1000));
        job = await c.queue.get(id);
      }
      if (!job) throw new Error(`Unknown job id "${id}".`);
      const base = { job: id, type: job.type, status: job.status, project: job.projectId };
      if (job.status === "error") return { ...base, error: job.error };
      if (job.status !== "done") return { ...base, hint: job.status === "queued" ? "Waiting for the render worker. Is it running (OPENMOTION_ROLE=all or worker)?" : "Still running, ask again." };
      if (job.type === "transcribe") {
        const res = job.result as { source: string; provider: string; language?: string; words: unknown[] };
        if (!job.applied) {
          await save(c, job.projectId!, [{ op: "transcript", set: { source: res.source, provider: res.provider, ...(res.language ? { language: res.language } : {}), words: res.words } } as PatchOp]);
          await c.queue.update(id, { applied: true });
        }
        return { ...base, words: res.words.length, language: res.language, hint: "Transcript saved. Next: get_transcript" };
      }
      const file = (job.result as { file?: string })?.file;
      return { ...base, file, url: file ? `${c.baseUrl}/projects/${job.projectId}/${file}?download` : undefined };
    },
  },
  {
    name: "get_transcript",
    description: "Transcript as word-id@time text. Times are SOURCE times of the recording (use them for cut/uncut). Also lists the current cuts and suggestions for filler words and long pauses.",
    inputSchema: obj({ project, include_cut: { type: "boolean", description: "Also show words that are already cut (marked with ~)" } }, ["project"]),
    run: async (a, c) => {
      const { spec } = await c.store.read(a.project);
      const tr = spec.transcript;
      if (!tr?.words.length) return "No transcript yet. Use transcribe first.";
      const words = tr.words.filter((w) => a.include_cut || !isWordCut(tr, w.id)).map((w) => `${w.id}@${r(w.t0)}-${r(w.t1)}${isWordCut(tr, w.id) ? "~" : ""} ${w.text}`);
      const sug = findSuggestions(tr);
      return [
        `SOURCE ${tr.source} · ${tr.words.length} words · video length after cuts ${r(compositionDuration(spec))} s`,
        `WORDS (id@start-end in the recording):\n${words.join("\n")}`,
        `CUTS: ${(tr.cuts ?? []).map((x) => `${r(x.t0)}-${r(x.t1)}${x.reason ? ` (${x.reason})` : ""}`).join(", ") || "none"}`,
        `SUGGESTIONS (apply with {"op":"cut","t0":…,"t1":…,"reason":…}):\n${sug.map((s) => `${s.kind} ${r(s.t0)}-${r(s.t1)} ${s.label ?? ""}`.trim()).join("\n") || "none"}`,
        `Composition time of a word (for scenes): sourceToComp, e.g. ${tr.words[0].id} starts at ${r(sourceToComp(spec, tr.words[0].t0))} s in the video.`,
      ].join("\n\n");
    },
  },
  {
    name: "export_video",
    description: "Render the video to MP4 (or GIF) in the background. height 720/1080/1440/2160 (default 1080), fps 24/25/30/50/60. Then job_status for the download link.",
    inputSchema: obj({ project, height: { type: "number" }, fps: { type: "number" }, format: { type: "string", enum: ["mp4", "gif"] } }, ["project"]),
    run: async (a, c) => {
      const request = sanitize({ height: a.height, fps: a.fps, format: a.format } as Partial<ExportRequest>);
      const { spec } = await c.store.read(a.project);
      const statsFile = path.resolve(c.dataDir, "render-stats.json");
      const est = await estimate(spec, { ...request, statsFile });
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      const name = `${a.project}-${request.height}p-${stamp}.${request.format}`;
      const job = await c.queue.enqueue("export", { projectId: a.project, spec, request, name }, { projectId: a.project, request, estimateSeconds: est.seconds, plan: est.plan });
      return { job: job.id, estimate_seconds: est.seconds, hint: "Call job_status with wait_seconds until status is done." };
    },
  },
  {
    name: "editor_url",
    description: "Link to open the project in the editor (shows changes live).",
    inputSchema: obj({ project }, ["project"]),
    run: async (a, c) => { c.store.dir(a.project); return editorUrl(c, a.project); },
  },
];

/** Applies ops to the saved spec and saves it. Throws with the exact patch error if anything is invalid. */
async function save(c: Ctx, id: string, ops: PatchOp[]) {
  const { spec } = await c.store.read(id);
  const res = applyPatch(spec, ops);
  const saved = await c.store.saveSpec(id, res.spec);
  return { ok: true, changed: res.changed, warnings: saved.warnings, duration: r(compositionDuration(res.spec)) };
}

/** Folders the import may read from: OPENMOTION_IMPORT_DIRS (":"-separated), else the home folder (not in Docker). */
export function importRoots(): string[] {
  const env = process.env.OPENMOTION_IMPORT_DIRS;
  if (env !== undefined) return env.split(path.delimiter).filter(Boolean).map((d) => path.resolve(d));
  return process.env.OPENMOTION_REQUIRE_AUTH === "1" ? [] : [os.homedir()];
}

function importable(p: string): string {
  if (!p || !path.isAbsolute(p)) throw new Error(`Give an absolute file path, e.g. ${path.join(os.homedir(), "Videos", "facecam.mp4")}.`);
  if (!existsSync(p) || !statSync(p).isFile()) throw new Error(`File not found: ${p}`);
  if (!kindOf(p)) throw new Error(`File type not supported: ${path.extname(p) || p}. Allowed: video (mp4, mov, mkv, webm, m4v), audio, images, fonts.`);
  const real = realpathSync(p);
  const roots = importRoots().map((d) => (existsSync(d) ? realpathSync(d) : d));
  if (!roots.some((root) => real === root || real.startsWith(root.endsWith(path.sep) ? root : root + path.sep))) {
    throw new Error(roots.length ? `Import only from: ${roots.join(", ")}. Move the file there or set OPENMOTION_IMPORT_DIRS.` : "Importing local files is off on this server (Docker). Set OPENMOTION_IMPORT_DIRS or upload the file in the editor.");
  }
  return real;
}

function unique(base: string, taken: Set<string>) {
  let cand = base;
  for (let i = 2; taken.has(cand); i++) cand = `${base}-${i}`;
  taken.add(cand);
  return cand;
}

const assetLine = (a: { path: string; kind: string; duration?: number; width?: number; height?: number; hasAudio?: boolean }) =>
  `${a.path} (${a.kind}${a.duration ? `, ${r(a.duration)} s` : ""}${a.width ? `, ${a.width}×${a.height}` : ""}${a.kind === "video" ? (a.hasAudio ? ", with sound" : ", no sound") : ""})`;
const editorUrl = (c: Ctx, id: string) => `${c.baseUrl}/#/p/${id}`;
const r = (v: number) => Math.round(v * 100) / 100;

// ---------- JSON-RPC ----------
type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method?: string; params?: any };

export async function handleRpc(msg: Rpc, c: Ctx): Promise<object | null> {
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id: msg.id ?? null, result });
  const fail = (code: number, message: string) => ({ jsonrpc: "2.0", id: msg.id ?? null, error: { code, message } });
  if (msg?.jsonrpc !== "2.0" || typeof msg.method !== "string") return fail(-32600, "Invalid JSON-RPC request");
  const isNote = msg.id === undefined;
  switch (msg.method) {
    case "initialize": {
      const asked = String(msg.params?.protocolVersion ?? "");
      return reply({ protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0], capabilities: { tools: { listChanged: false } }, serverInfo: { name: "open-motion", title: "Open Motion", version: VERSION }, instructions: INSTRUCTIONS });
    }
    case "ping": return reply({});
    case "tools/list": return reply({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === msg.params?.name);
      if (!tool) return fail(-32602, `Unknown tool "${msg.params?.name}". Available: ${TOOLS.map((t) => t.name).join(", ")}`);
      try {
        const out = await tool.run(msg.params?.arguments ?? {}, c);
        return reply({ content: [{ type: "text", text: typeof out === "string" ? out : JSON.stringify(out, null, 2) }] });
      } catch (e) {
        return reply({ content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true });
      }
    }
    default:
      return isNote ? null : fail(-32601, `Method not found: ${msg.method}`);
  }
}

/** Route handler for createServer({ extra }). Handles /mcp, returns false for everything else. */
export function mcpRoute() {
  return async (req: http.IncomingMessage, res: http.ServerResponse, ctx: ServerContext): Promise<boolean> => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/mcp") return false;
    const send = (status: number, body?: unknown) => {
      res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...(status === 405 ? { allow: "POST" } : {}) });
      res.end(body === undefined ? "" : JSON.stringify(body));
    };
    try {
      if (req.method !== "POST") return send(405, { error: "Open Motion MCP: use POST (Streamable HTTP, JSON answers)." }), true;
      const who = await ctx.auth.who(req);
      if (!who.ok || who.via === "session") return send(401, { error: "Open Motion MCP: send an API token as 'Authorization: Bearer <token>' (editor → ⚙ Settings → Access for AIs)." }), true;
      if (who.via === "open" && !(isLocal(req.headers.host) && (!req.headers.origin || isLocal(safeHost(req.headers.origin))))) {
        return send(403, { error: "Open Motion MCP without password only works from localhost. Set OPENMOTION_PASSWORD and use an API token." }), true;
      }
      if (!/application\/json/i.test(String(req.headers["content-type"] ?? ""))) return send(415, { error: "Content-Type must be application/json." }), true;
      const body = await readJson(req);
      const proto = req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
      const c: Ctx = { ...ctx, baseUrl: `${proto}://${req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost:4317"}` };
      if (Array.isArray(body)) {
        const out = (await Promise.all(body.map((m) => handleRpc(m, c)))).filter(Boolean);
        return out.length ? send(200, out) : send(202), true;
      }
      const out = await handleRpc(body as Rpc, c);
      return out ? send(200, out) : send(202), true;
    } catch (e) {
      send(e instanceof HttpError ? e.status : 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: (e as Error).message } });
      return true;
    }
  };
}

const safeHost = (origin: string) => { try { return new URL(origin).host; } catch { return ""; } };
function isLocal(host?: string): boolean {
  const h = String(host ?? "").replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const ch of req) {
    size += (ch as Buffer).length;
    if (size > 16 * 1024 * 1024) throw new HttpError(413, "request body too large");
    chunks.push(ch as Buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new Error("Body is not valid JSON."); }
}

