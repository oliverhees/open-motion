// Project store: one folder per project, plain files, easy to back up, sync (Nextcloud) or put in git.
//
//   <data>/projects/<id>/
//     project.json     title, created, updated
//     spec.json        the Motion-Spec (single source of truth)
//     comments.json    comments on elements (for people and AI)
//     assets/
//       images/  video/  audio/  fonts/
//     renders/         exported MP4/GIF
//     history/         spec snapshots (autosave versions)

import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { applyPatch, compositionDuration, validateSpec, SpecError, FORMAT_SIZE, getStyle, type Format, type MotionSpec, type Layer } from "@openmotion/core";
import { ensureFonts } from "./fonts.ts";
import { probe } from "./media.ts";

export interface ProjectInfo {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  duration?: number;
}

export interface Comment {
  id: string;
  /** Composition time in seconds. */
  t: number;
  layer?: string;
  /** Click position in canvas px. */
  x?: number;
  y?: number;
  text: string;
  toAI: boolean;
  status: "open" | "queued" | "done";
  createdAt: string;
  /** Answer from the AI after it handled the comment. */
  reply?: string;
}

export const ASSET_DIRS = ["images", "video", "audio", "fonts"] as const;
const ID_RE = /^[a-z0-9][a-z0-9-]{1,80}$/;
const HISTORY_EVERY_MS = 60_000;
const HISTORY_KEEP = 50;

export class Store {
  readonly root: string;
  readonly examplesDir: string;
  constructor(dataDir: string, examplesDir: string) {
    this.root = path.resolve(dataDir, "projects");
    this.examplesDir = examplesDir;
  }

  dir(id: string): string {
    if (!ID_RE.test(id)) throw new HttpError(400, `Invalid project id "${id}"`);
    const d = path.join(this.root, id);
    if (!existsSync(d)) throw new HttpError(404, `Project "${id}" not found`);
    return d;
  }

  async list(): Promise<ProjectInfo[]> {
    await mkdir(this.root, { recursive: true });
    const out: ProjectInfo[] = [];
    for (const e of await readdir(this.root, { withFileTypes: true })) {
      if (!e.isDirectory() || !ID_RE.test(e.name)) continue;
      try {
        const info = await readJson<ProjectInfo>(path.join(this.root, e.name, "project.json"));
        const spec = await readJson<MotionSpec>(path.join(this.root, e.name, "spec.json"));
        out.push({ ...info, duration: round(compositionDuration(spec)) });
      } catch {
        /* skip broken folders */
      }
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async create(title: string, template: "blank" | "example", lang: "de" | "en" = "en", opts: { format?: Format; style?: string } = {}): Promise<ProjectInfo> {
    const clean = title.trim().slice(0, 120) || (lang === "de" ? "Neues Projekt" : "New project");
    const id = `${slug(clean)}-${randomBytes(3).toString("hex")}`;
    const dir = path.join(this.root, id);
    for (const sub of ["renders", "history", ...ASSET_DIRS.map((a) => `assets/${a}`)]) await mkdir(path.join(dir, sub), { recursive: true });
    let spec: MotionSpec;
    if (template === "example") spec = await this.copyExample(dir);
    else spec = blankSpec(lang, opts);
    spec.meta.title = clean;
    // The style's fonts are fetched right away, so the first preview already looks right.
    if (opts.style && process.env.OPENMOTION_NO_FONT_DOWNLOAD !== "1") {
      const fonts = await ensureFonts(spec, dir).catch(() => null);
      if (fonts?.op) spec = applyPatch(spec, [fonts.op]).spec;
    }
    const now = new Date().toISOString();
    const info: ProjectInfo = { id, title: clean, createdAt: now, updatedAt: now };
    await writeJson(path.join(dir, "project.json"), info);
    await writeJson(path.join(dir, "spec.json"), spec);
    await writeJson(path.join(dir, "comments.json"), []);
    return info;
  }

  async read(id: string) {
    const d = this.dir(id);
    return {
      project: await readJson<ProjectInfo>(path.join(d, "project.json")),
      spec: await readJson<MotionSpec>(path.join(d, "spec.json")),
      comments: await readJson<Comment[]>(path.join(d, "comments.json")).catch(() => [] as Comment[]),
    };
  }

  /** Last change of the spec. The editor polls this to show changes from AIs (MCP) live. */
  async rev(id: string): Promise<string> {
    return (await readJson<ProjectInfo>(path.join(this.dir(id), "project.json"))).updatedAt;
  }

  async saveSpec(id: string, spec: MotionSpec): Promise<{ warnings: string[]; updatedAt: string }> {
    const d = this.dir(id);
    const check = validateSpec(spec);
    if (!check.ok) throw new HttpError(422, new SpecError(check.errors).message);
    await this.snapshot(d);
    await writeJson(path.join(d, "spec.json"), spec);
    const info = await readJson<ProjectInfo>(path.join(d, "project.json"));
    info.updatedAt = new Date().toISOString();
    info.title = spec.meta.title || info.title;
    await writeJson(path.join(d, "project.json"), info);
    return { warnings: check.warnings, updatedAt: info.updatedAt };
  }

  async saveComments(id: string, comments: Comment[]): Promise<void> {
    const d = this.dir(id);
    if (!Array.isArray(comments)) throw new HttpError(422, "comments must be an array");
    const clean = comments.slice(0, 2000).map((c) => {
      if (typeof c.text !== "string" || typeof c.t !== "number") throw new HttpError(422, "each comment needs text and t");
      return {
        id: String(c.id || `c-${randomBytes(4).toString("hex")}`),
        t: c.t,
        layer: c.layer ? String(c.layer) : undefined,
        x: typeof c.x === "number" ? c.x : undefined,
        y: typeof c.y === "number" ? c.y : undefined,
        text: c.text.slice(0, 4000),
        toAI: Boolean(c.toAI),
        status: (["open", "queued", "done"] as const).includes(c.status) ? c.status : "open",
        createdAt: c.createdAt || new Date().toISOString(),
        reply: typeof c.reply === "string" ? c.reply.slice(0, 2000) : undefined,
      } satisfies Comment;
    });
    await writeJson(path.join(d, "comments.json"), clean);
  }

  async assets(id: string): Promise<{ path: string; kind: string; size: number; duration?: number; width?: number; height?: number; hasAudio?: boolean }[]> {
    const d = this.dir(id);
    const out: { path: string; kind: string; size: number; duration?: number; width?: number; height?: number; hasAudio?: boolean }[] = [];
    for (const kind of ASSET_DIRS) {
      const sub = path.join(d, "assets", kind);
      if (!existsSync(sub)) continue;
      for (const f of await readdir(sub)) {
        const st = await stat(path.join(sub, f));
        if (!st.isFile() || f.startsWith(".")) continue;
        const entry: (typeof out)[number] = { path: `assets/${kind}/${f}`, kind, size: st.size };
        if (kind !== "fonts" && !f.endsWith(".txt")) {
          const info = await probe(path.join(sub, f)).catch(() => null);
          if (info) Object.assign(entry, { duration: kind === "images" ? undefined : info.duration, width: info.width, height: info.height, hasAudio: info.hasAudio });
        }
        if (!f.endsWith(".txt")) out.push(entry);
      }
    }
    return out;
  }

  async readChat(id: string): Promise<unknown[]> {
    return readJson<unknown[]>(path.join(this.dir(id), "chat.json")).catch(() => []);
  }

  async saveChat(id: string, chat: unknown[]): Promise<void> {
    if (!Array.isArray(chat)) throw new HttpError(422, "chat must be an array");
    await writeJson(path.join(this.dir(id), "chat.json"), chat.slice(-300));
  }

  async history(id: string): Promise<string[]> {
    const d = this.dir(id);
    return (await readdir(path.join(d, "history")).catch(() => [])).filter((f) => f.endsWith(".json")).sort().reverse();
  }

  private async snapshot(dir: string) {
    const hist = path.join(dir, "history");
    await mkdir(hist, { recursive: true });
    const files = (await readdir(hist)).filter((f) => f.endsWith(".json")).sort();
    const last = files[files.length - 1];
    if (last) {
      const st = await stat(path.join(hist, last));
      if (Date.now() - st.mtimeMs < HISTORY_EVERY_MS) return;
    }
    if (existsSync(path.join(dir, "spec.json"))) {
      const name = `spec-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      await cp(path.join(dir, "spec.json"), path.join(hist, name));
    }
    for (const old of files.slice(0, Math.max(0, files.length + 1 - HISTORY_KEEP))) await rm(path.join(hist, old), { force: true });
  }

  /** Copies the example and sorts its files into assets/images|video|audio|fonts. */
  private async copyExample(dir: string): Promise<MotionSpec> {
    const src = this.examplesDir;
    const spec = await readJson<MotionSpec>(path.join(src, "spec.json"));
    const moved = new Map<string, string>();
    const target = (rel: string) => {
      const ext = path.extname(rel).toLowerCase();
      const kind = rel.includes("/fonts/") || [".woff2", ".woff", ".ttf", ".otf"].includes(ext) ? "fonts"
        : [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"].includes(ext) ? "images"
        : [".mp3", ".wav", ".m4a", ".aac", ".ogg"].includes(ext) ? "audio" : "video";
      return `assets/${kind}/${path.basename(rel)}`;
    };
    const refs = [...spec.layers.filter((l): l is Layer & { src: string } => "src" in l).map((l) => l.src), ...(spec.style?.fonts ?? []).map((f) => f.src)];
    for (const rel of new Set(refs)) {
      const to = target(rel);
      moved.set(rel, to);
      if (existsSync(path.join(src, rel))) await cp(path.join(src, rel), path.join(dir, to));
    }
    for (const l of spec.layers) if ("src" in l) (l as { src: string }).src = moved.get(l.src) ?? l.src;
    for (const f of spec.style?.fonts ?? []) f.src = moved.get(f.src) ?? f.src;
    if (spec.transcript?.source) spec.transcript.source = moved.get(spec.transcript.source) ?? spec.transcript.source;
    const lic = path.join(src, "assets/fonts/OFL.txt");
    if (existsSync(lic)) await cp(lic, path.join(dir, "assets/fonts/OFL.txt"));
    return spec;
  }
}

/**
 * A fresh project. With a style it already looks designed: style palette and fonts, a radial glow,
 * a masked headline with a marker highlight. Starter layers carry meta.placeholder so the AI replaces them.
 */
export function blankSpec(lang: "de" | "en" = "en", opts: { format?: Format; style?: string } = {}): MotionSpec {
  const de = lang === "de";
  const { width: W, height: H } = FORMAT_SIZE[opts.format ?? "16:9"];
  const st = getStyle(opts.style);
  const vertical = H > W;
  const m = Math.round(Math.min(W, H) * 0.08);
  const ph = { placeholder: true };
  // Narrow canvases (1:1, 4:5, 9:16) get three explicit lines, landscape two. The size is chosen so the
  // longest line fits (≈ 0.75 em per character, or the style's displayWidth for very wide fonts), so it never wraps.
  const narrow = W / H < 1.2;
  const dw = st?.fonts.displayWidth ?? 0.75;
  const first = vertical && dw > 0.7 ? (de ? "Dein\nVideo," : "Your\nvideo,") : de ? "Dein Video," : "Your video,"; // very wide font in portrait: 4 lines
  const text = de ? (narrow ? `${first}\n[[großartig]]\nerzählt.` : `${first}\n[[großartig]] erzählt.`) : (narrow ? `${first}\n[[beautifully]]\ntold.` : `${first}\n[[beautifully]] told.`);
  const lines = text.split("\n").length;
  const longest = Math.max(...text.replace(/\[\[|\]\]/g, "").split("\n").map((l) => l.length));
  const big = Math.min(Math.round(Math.min(W, H) * 0.15), Math.floor((W - 2 * m) / (longest * dw)));
  const body = Math.max(Math.round(big * 0.32), vertical ? 44 : narrow ? 36 : 40);
  const top = Math.round(H * (vertical ? 0.3 : narrow ? 0.26 : 0.32));
  const spec: MotionSpec = {
    version: 1,
    meta: { title: de ? "Neues Projekt" : "New project", lang, ...(st ? { style: st.id } : {}) },
    canvas: { width: W, height: H, fps: 30, background: "$bg", ...(st?.texture ? { texture: st.texture } : {}) },
    style: { palette: st ? { ...st.palette } : { bg: "#111827", surface: "#1F2937", ink: "#F9FAFB", muted: "#94A3B8", accent: "#38BDF8" } },
    scenes: [{ id: "s1", name: de ? "Szene 1" : "Scene 1", duration: 5 }],
    layers: [
      { id: "bg", name: de ? "Hintergrund" : "Background", type: "shape", shape: "rect", track: 0, start: 0, duration: 5, locked: true, frame: { x: 0, y: 0, w: W, h: H }, fill: "$bg" },
      {
        id: "glow", name: "Glow", type: "shape", shape: "ellipse", track: 1, start: 0, duration: 5, meta: ph,
        frame: { x: Math.round(W * 0.45), y: Math.round(H * -0.1), w: Math.round(Math.max(W, H) * 0.7), h: Math.round(Math.max(W, H) * 0.7), opacity: 0.35 },
        fill: "radial-gradient(circle, $accent 0%, transparent 65%)", in: { type: "fade", duration: 1.2 },
      },
      {
        id: "title", name: de ? "Titel" : "Title", type: "text", scene: "s1", track: 5, start: 0.3, duration: 4.5, meta: ph,
        frame: { x: m, y: top, w: W - 2 * m, h: Math.round(big * 1.05 * lines + big * 0.3) },
        text,
        style: { fontSize: big, fontWeight: st?.fonts.displayWeight ?? 800, color: "$ink", lineHeight: 1.02, letterSpacing: Math.round(-big * 0.03), highlight: "$accent", ...(st ? { fontFamily: st.fonts.display } : {}) },
        anim: { type: "mask", by: "word", stagger: 0.08, duration: 0.8, ease: "expo.out" }, out: { type: "fade", duration: 0.4 },
      },
      {
        id: "sub", name: de ? "Untertitel" : "Subtitle", type: "text", scene: "s1", track: 5, start: 1.1, duration: 3.7, meta: ph,
        frame: { x: m, y: Math.round(top + big * 1.05 * lines + big * 0.6), w: W - 2 * m, h: Math.round(body * 1.3 * 2) },
        text: de ? "Schreib links in den Chat, was du willst." : "Tell the chat on the left what you want.",
        style: { fontSize: body, fontWeight: st?.fonts.bodyWeight ?? 400, color: "$muted", ...(st ? { fontFamily: st.fonts.body } : {}) },
        in: { type: "fade", duration: 0.8 }, out: { type: "fade", duration: 0.4 },
      },
    ],
  };
  return spec;
}

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

/** Atomic write: temp file + rename, so a crash never leaves half a spec. */
async function writeJson(file: string, data: unknown) {
  const tmp = `${file}.${randomBytes(3).toString("hex")}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  await rename(tmp, file);
}

function slug(s: string): string {
  const base = s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return base || "projekt";
}
const round = (v: number) => Math.round(v * 100) / 100;
