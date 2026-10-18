// HTTP server: JSON API, project files (with Range for video seeking), the built editor.
// Protection: password session for the editor, API tokens for AIs (see auth.ts).
// Heavy work (export, transcription) goes into the shared queue and is done by the render worker.

import http from "node:http";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { Store, HttpError, type Comment } from "./store.ts";
import { sanitize, type ExportRequest } from "./jobs.ts";
import { SettingsStore, type Provider } from "./settings.ts";
import { receiveUpload } from "./media.ts";
import { localAvailable } from "./transcribe.ts";
import { Tasks } from "./tasks.ts";
import { fakeImage, runAgent, type AgentRequest } from "./ai/agent.ts";
import { aspectFor, generateImage } from "./ai/images.ts";
import { diagnose, formatReport } from "./diagnose.ts";
import { Auth, sessionCookie } from "./auth.ts";
import { FileQueue, type QueueJob } from "./queue.ts";
import { workerFile, type WorkerInfo } from "./worker.ts";
import { detectHardware, estimate, readStats } from "@openmotion/render";
import { applyPatch, FORMATS, getStyle, type Format, type MotionSpec } from "@openmotion/core";
import { ensureFonts, missingFamilies, previewFont } from "./fonts.ts";
import { imagesAvailable, kieCredits, localMcps } from "./integrations.ts";

export interface ServerOptions {
  dataDir: string;
  examplesDir: string;
  editorDist?: string;
  /** Extra route handler (the MCP endpoint plugs in here). Return true if handled. */
  extra?: (req: http.IncomingMessage, res: http.ServerResponse, ctx: ServerContext) => Promise<boolean>;
}

export interface ServerContext { store: Store; settings: SettingsStore; queue: FileQueue; auth: Auth; tasks: Tasks; dataDir: string; examplesDir: string }

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".mp4": "video/mp4", ".webm": "video/webm",
  ".mov": "video/quicktime", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav", ".ogg": "audio/ogg",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".otf": "font/otf", ".txt": "text/plain; charset=utf-8",
};

export function readWorker(dataDir: string): (WorkerInfo & { online: boolean }) | null {
  try {
    const w = JSON.parse(readFileSync(workerFile(dataDir), "utf8")) as WorkerInfo;
    return { ...w, online: Date.now() - Date.parse(w.at) < 45_000 };
  } catch {
    return null;
  }
}

/** Job shape the editor expects (export: file/size top level; transcribe: Task-like). */
function view(j: QueueJob) {
  return { ...j, payload: undefined, estimateSeconds: j.estimateSeconds ?? 0 };
}

export function createServer(opts: ServerOptions) {
  const store = new Store(opts.dataDir, opts.examplesDir);
  const settings = new SettingsStore(opts.dataDir);
  const tasks = new Tasks();
  const queue = new FileQueue(opts.dataDir);
  const auth = new Auth(opts.dataDir);
  const statsFile = path.resolve(opts.dataDir, "render-stats.json");
  const modelsDir = path.resolve(opts.dataDir, "models");
  const ctx: ServerContext = { store, settings, queue, auth, tasks, dataDir: opts.dataDir, examplesDir: opts.examplesDir };
  let localCache: { at: number; ok: boolean } | null = null;

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
      const m = req.method ?? "GET";
      const ip = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "?").split(",")[0].trim();

      // ---------- public ----------
      if (parts[0] === "api" && parts[1] === "health") {
        const w = readWorker(opts.dataDir);
        return json(res, 200, { ok: true, role: process.env.OPENMOTION_ROLE ?? "all", worker: w ? { online: w.online, lastSeen: w.at, busy: w.busy } : null });
      }
      if (parts[0] === "api" && parts[1] === "auth") {
        if (parts[2] === "me") {
          const who = await auth.who(req);
          return json(res, 200, { required: auth.enabled, authenticated: who.ok, via: who.via ?? null });
        }
        if (parts[2] === "login" && m === "POST") {
          const body = await readBody<{ password?: string }>(req);
          const sid = await auth.login(String(body.password ?? ""), ip);
          if (sid === "locked") throw new HttpError(429, "Zu viele Versuche. Bitte 15 Minuten warten.");
          if (!sid) throw new HttpError(401, "Falsches Passwort.");
          res.setHeader("set-cookie", sessionCookie(sid, req));
          return json(res, 200, { ok: true });
        }
        if (parts[2] === "logout" && m === "POST") {
          await auth.logout(req);
          res.setHeader("set-cookie", sessionCookie("", req, true));
          return json(res, 200, { ok: true });
        }
      }
      if (opts.extra && (await opts.extra(req, res, ctx))) return;

      // ---------- everything below needs a session or token ----------
      const isApi = parts[0] === "api";
      const isFiles = parts[0] === "projects";
      if (isApi || isFiles) {
        const who = await auth.who(req);
        if (!who.ok) throw new HttpError(401, auth.enabled ? "Bitte anmelden." : "Ungültiges Token.");
        if (who.via === "session" && m !== "GET" && m !== "HEAD" && req.headers["x-om"] !== "1") throw new HttpError(403, "Fehlender Schutz-Header (x-om).");
        if (isApi && parts[1] === "tokens") {
          if (who.via === "token") throw new HttpError(403, "Tokens können nur im Editor verwaltet werden.");
          if (!parts[2] && m === "GET") return json(res, 200, await auth.listTokens());
          if (!parts[2] && m === "POST") return json(res, 201, await auth.createToken(String((await readBody<{ name?: string }>(req)).name ?? "")));
          if (parts[2] && m === "DELETE") return json(res, (await auth.revoke(parts[2])) ? 200 : 404, { ok: true });
        }
      }

      if (isApi) {
        if (parts[1] === "settings" && parts.length === 2) {
          if (m === "GET") return json(res, 200, await settings.readPublic());
          if (m === "PUT") return json(res, 200, await settings.update(await readBody(req)));
        }
        if (parts[1] === "capabilities" && m === "GET") {
          const w = readWorker(opts.dataDir);
          let local: boolean;
          if (w?.online) local = w.localWhisper;
          else {
            if (!localCache || Date.now() - localCache.at > 60_000) localCache = { at: Date.now(), ok: await localAvailable() };
            local = localCache.ok;
          }
          const pub = await settings.readPublic();
          return json(res, 200, { localWhisper: local, workerOnline: !!w?.online, keys: Object.fromEntries(Object.entries(pub.keys).map(([k, v]) => [k, v.set])) });
        }
        if (parts[1] === "system" && m === "GET") {
          const w = readWorker(opts.dataDir);
          return json(res, 200, { worker: w, hardware: w?.hardware ?? (await detectHardware()), stats: await readStats(statsFile) });
        }
        if (parts[1] === "diagnose" && m === "POST") {
          const body = await readBody<{ images?: boolean; agent?: boolean }>(req);
          const s = await settings.read();
          return json(res, 202, tasks.start("diagnose", async () => {
            const checks = await diagnose(s, { images: !!body.images, agent: !!body.agent, exampleSpec: path.join(opts.examplesDir, "spec.json") });
            const w = readWorker(opts.dataDir);
            checks.unshift(w ? { area: "System", name: "Render-Worker", ok: w.online, ms: 0, detail: w.online ? `online (${w.host}), ${w.busy ? "arbeitet gerade" : "wartet auf Aufträge"}` : `zuletzt gesehen ${w.at}` }
              : { area: "System", name: "Render-Worker", ok: false, ms: 0, detail: "noch nie gestartet", hint: "Worker-Dienst starten (OPENMOTION_ROLE=worker) oder lokal mit OPENMOTION_ROLE=all." });
            return { checks, report: formatReport(checks, s) };
          }));
        }
        if (parts[1] === "integrations" && m === "GET") {
          const s = await settings.read();
          const mcps = localMcps();
          return json(res, 200, { images: imagesAvailable(s), imageProvider: s.images.provider, kieCredits: await kieCredits(s), mcps, kieMcp: mcps.filter((x) => /kie/i.test(x.name)) });
        }
        if (parts[1] === "fontfile" && parts[2] && m === "GET") {
          const file = await previewFont(parts[2], path.resolve(opts.dataDir, "fontcache"));
          if (!file) throw new HttpError(404, "font not found");
          res.setHeader("cache-control", "public, max-age=31536000, immutable");
          return sendFile(req, res, file, false);
        }
        if (parts[1] === "dictate" && m === "POST") {
          // Voice input (chat, interview): raw audio body → text, through the transcription queue.
          const dir = path.resolve(opts.dataDir, "tmp");
          await mkdir(dir, { recursive: true });
          const file = path.join(dir, `dictate-${randomBytes(5).toString("hex")}.${/ogg/.test(String(req.headers["content-type"])) ? "ogg" : /mp4|m4a/.test(String(req.headers["content-type"])) ? "m4a" : "webm"}`);
          let size = 0;
          const chunks: Buffer[] = [];
          for await (const c of req) {
            size += (c as Buffer).length;
            if (size > 25 * 1024 * 1024) throw new HttpError(413, "Aufnahme zu lang (max. 25 MB).");
            chunks.push(c as Buffer);
          }
          if (!size) throw new HttpError(400, "leere Aufnahme");
          await writeFile(file, Buffer.concat(chunks));
          const lang = url.searchParams.get("lang") ?? undefined;
          const job = await queue.enqueue("dictate", { file: path.basename(file), language: lang && /^[a-z]{2}$/.test(lang) ? lang : undefined });
          return json(res, 202, view(job));
        }
        if (parts[1] === "tasks" && parts[2] && m === "GET") {
          const task = tasks.get(parts[2]) ?? (/^[a-f0-9]{10}$/.test(parts[2]) ? await queue.get(parts[2]) : undefined);
          if (!task) throw new HttpError(404, "task not found");
          return json(res, 200, "payload" in task ? view(task as QueueJob) : task);
        }
        if (parts[1] === "jobs" && parts[2] && m === "GET") {
          const job = /^[a-f0-9]{10}$/.test(parts[2]) ? await queue.get(parts[2]) : undefined;
          if (!job) throw new HttpError(404, "job not found");
          return json(res, 200, view(job));
        }
        if (parts[1] === "projects" && parts.length === 2) {
          if (m === "GET") return json(res, 200, await store.list());
          if (m === "POST") {
            const body = await readBody<{ title?: string; template?: string; lang?: string; format?: string; style?: string }>(req);
            const format = (FORMATS as readonly string[]).includes(body.format ?? "") ? (body.format as Format) : undefined;
            const style = getStyle(body.style)?.id;
            return json(res, 201, await store.create(body.title ?? "", body.template === "example" ? "example" : "blank", body.lang === "de" ? "de" : "en", { format, style }));
          }
        }
        if (parts[1] === "projects" && parts[2]) {
          const id = parts[2];
          const sub = parts[3];
          if (!sub && m === "GET") return json(res, 200, await store.read(id));
          if (sub === "rev" && m === "GET") return json(res, 200, { updatedAt: await store.rev(id) });
          if (sub === "spec" && m === "PUT") {
            const body = await readBody<MotionSpec>(req);
            const saved = await store.saveSpec(id, body);
            // A font typed in the editor is fetched in the background; the editor picks the update up live.
            if (process.env.OPENMOTION_NO_FONT_DOWNLOAD !== "1" && missingFamilies(body).length) {
              void ensureFonts(body, store.dir(id)).then(async (r) => {
                if (!r.op) return;
                const { spec: now } = await store.read(id);
                await store.saveSpec(id, applyPatch(now, [r.op]).spec);
              }).catch(() => {});
            }
            return json(res, 200, saved);
          }
          if (sub === "comments" && m === "PUT") {
            await store.saveComments(id, await readBody<Comment[]>(req));
            return json(res, 200, { ok: true });
          }
          if (sub === "assets" && m === "GET") return json(res, 200, await store.assets(id));
          if (sub === "history" && m === "GET") return json(res, 200, await store.history(id));
          if (sub === "upload" && m === "POST") {
            const name = url.searchParams.get("name");
            if (!name) throw new HttpError(400, "?name= fehlt");
            return json(res, 201, await receiveUpload(req, store.dir(id), name));
          }
          if (sub === "chat" && m === "GET") return json(res, 200, await store.readChat(id));
          if (sub === "chat" && m === "PUT") {
            await store.saveChat(id, await readBody<unknown[]>(req, 4 * 1024 * 1024));
            return json(res, 200, { ok: true });
          }
          if (sub === "ai" && !parts[4] && m === "POST") {
            const body = await readBody<AgentRequest>(req, 16 * 1024 * 1024);
            if (!body?.spec || !["chat", "comment", "transcript"].includes(body.kind)) throw new HttpError(422, "kind und spec fehlen");
            const dir = store.dir(id);
            const s = await settings.read();
            return json(res, 202, tasks.start("ai", (progress) => runAgent(body, { settings: s, projectDir: dir, onProgress: progress })));
          }
          if (sub === "ai" && parts[4] === "image" && m === "POST") {
            const body = await readBody<{ prompt?: string; w?: number; h?: number }>(req);
            if (!body.prompt?.trim()) throw new HttpError(422, "prompt fehlt");
            const dir = store.dir(id);
            const s = await settings.read();
            return json(res, 202, tasks.start("image", () => (process.env.OPENMOTION_FAKE_AI === "1" ? fakeImage(dir) : generateImage(s, body.prompt!.trim(), aspectFor(body.w ?? 16, body.h ?? 9), dir))));
          }
          if (sub === "transcribe" && m === "POST") {
            const body = await readBody<{ source?: string; provider?: Provider; language?: string; model?: string }>(req);
            const dir = store.dir(id);
            const file = path.resolve(dir, body.source ?? "");
            if (!body.source || !file.startsWith(path.join(dir, "assets") + path.sep) || !existsSync(file)) throw new HttpError(422, "source muss eine Datei unter assets/ sein");
            const job = await queue.enqueue("transcribe", { projectId: id, source: body.source, provider: body.provider, language: body.language, model: body.model }, { projectId: id });
            return json(res, 202, view(job));
          }
          if (sub === "export" && m === "POST") {
            const request = sanitize(await readBody<Partial<ExportRequest>>(req));
            const { spec } = await store.read(id);
            const w = readWorker(opts.dataDir);
            const est = await estimate(spec, { ...request, statsFile, hardware: w?.hardware });
            const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
            const name = `${id}-${request.height}p-${stamp}.${request.format}`;
            const job = await queue.enqueue("export", { projectId: id, spec, request, name }, { projectId: id, request, estimateSeconds: est.seconds, plan: est.plan });
            return json(res, 202, { ...view(job), workerOnline: !!w?.online });
          }
          if (sub === "estimate" && m === "POST") {
            const r = sanitize(await readBody<Partial<ExportRequest>>(req));
            const { spec } = await store.read(id);
            return json(res, 200, await estimate(spec, { ...r, statsFile, hardware: readWorker(opts.dataDir)?.hardware }));
          }
        }
        throw new HttpError(404, `No route for ${m} ${url.pathname}`);
      }

      // Project files: /projects/:id/assets/... and /projects/:id/renders/...
      if (isFiles && parts[1] && (parts[2] === "assets" || parts[2] === "renders")) {
        const base = store.dir(parts[1]);
        const file = path.resolve(base, ...parts.slice(2));
        if (!file.startsWith(base + path.sep)) throw new HttpError(403, "forbidden");
        return sendFile(req, res, file, url.searchParams.has("download"));
      }

      // Editor (single page app, public: it shows the login itself)
      if (opts.editorDist && existsSync(opts.editorDist)) {
        const rel = parts.length ? parts.join("/") : "index.html";
        let file = path.resolve(opts.editorDist, rel);
        if (!file.startsWith(path.resolve(opts.editorDist)) || !existsSync(file) || statSync(file).isDirectory()) file = path.join(opts.editorDist, "index.html");
        return sendFile(req, res, file, false);
      }
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end("OpenMotion API läuft. Editor bauen: npm run editor:build");
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      json(res, status, { error: (e as Error).message });
    }
  });
}

function json(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}

async function readBody<T>(req: http.IncomingMessage, limit = 8 * 1024 * 1024): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new HttpError(413, "request body too large");
    chunks.push(c as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as T;
  } catch {
    throw new HttpError(400, "body is not valid JSON");
  }
}

/** Static file with HTTP Range support, so the browser can seek in videos. */
function sendFile(req: http.IncomingMessage, res: http.ServerResponse, file: string, download: boolean) {
  if (!existsSync(file) || !statSync(file).isFile()) throw new HttpError(404, "file not found");
  const size = statSync(file).size;
  const type = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
  const headers: Record<string, string | number> = { "content-type": type, "accept-ranges": "bytes", "cache-control": "no-cache" };
  if (download) headers["content-disposition"] = `attachment; filename="${path.basename(file)}"`;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : size - Number(range[2]);
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      res.writeHead(416, { "content-range": `bytes */${size}` });
      return res.end();
    }
    res.writeHead(206, { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1 });
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, "content-length": size });
  createReadStream(file).pipe(res);
}
