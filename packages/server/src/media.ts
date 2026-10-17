// Uploads and recordings: sort into assets/<kind>/, convert video to seekable MP4, read metadata.

import { spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type http from "node:http";
import { HttpError } from "./store.ts";

export type AssetKind = "images" | "video" | "audio" | "fonts";
const KINDS: Record<AssetKind, string[]> = {
  images: [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"],
  video: [".mp4", ".webm", ".mov", ".mkv", ".m4v"],
  audio: [".mp3", ".wav", ".m4a", ".aac", ".ogg", ".opus", ".flac"],
  fonts: [".woff2", ".woff", ".ttf", ".otf"],
};
const MAX_UPLOAD = 4 * 1024 ** 3;

export function kindOf(filename: string): AssetKind | null {
  const ext = path.extname(filename).toLowerCase();
  for (const [k, list] of Object.entries(KINDS)) if (list.includes(ext)) return k as AssetKind;
  return null;
}

export function safeName(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const base = path.basename(filename, path.extname(filename)).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss").replace(/[^a-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 60);
  return `${base || "datei"}${ext}`;
}

export interface MediaInfo {
  duration?: number;
  width?: number;
  height?: number;
  hasVideo: boolean;
  hasAudio: boolean;
  vcodec?: string;
}

export interface UploadResult extends MediaInfo {
  path: string;
  kind: AssetKind;
  size: number;
  converted: boolean;
}

/** Streams the request body into the project's assets folder. Videos become H.264/AAC MP4 with constant frame rate. */
export async function receiveUpload(req: http.IncomingMessage, projectDir: string, filename: string): Promise<UploadResult> {
  const kind = kindOf(filename);
  if (!kind) throw new HttpError(415, `Dateityp nicht unterstützt: ${path.extname(filename) || filename}`);
  const dir = path.join(projectDir, "assets", kind);
  const tmp = path.join(dir, `.upload-${randomBytes(4).toString("hex")}`);
  let size = 0;
  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(tmp);
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_UPLOAD) {
        req.destroy();
        out.destroy();
        reject(new HttpError(413, "Datei größer als 4 GB"));
      }
    });
    req.pipe(out);
    out.on("finish", resolve);
    out.on("error", reject);
    req.on("error", reject);
  }).catch(async (e) => {
    await rm(tmp, { force: true });
    throw e;
  });
  if (size === 0) {
    await rm(tmp, { force: true });
    throw new HttpError(400, "leere Datei");
  }

  let name = safeName(filename);
  let converted = false;
  let final: string;
  if (kind === "video") {
    const info = await probe(tmp).catch(() => null);
    if (!info?.hasVideo) {
      await rm(tmp, { force: true });
      throw new HttpError(422, "Die Datei enthält kein lesbares Video.");
    }
    if (path.extname(name) !== ".mp4" || info.vcodec !== "h264") {
      name = name.replace(/\.[^.]+$/, ".mp4");
      final = unique(dir, name);
      await toMp4(tmp, final, info.hasAudio);
      await rm(tmp, { force: true });
      converted = true;
    } else {
      final = unique(dir, name);
      await rename(tmp, final);
    }
  } else {
    final = unique(dir, name);
    await rename(tmp, final);
  }
  const info: MediaInfo = kind === "video" || kind === "audio" ? await probe(final) : { hasVideo: false, hasAudio: false };
  if (kind === "images") Object.assign(info, await probe(final).then((p) => ({ width: p.width, height: p.height })).catch(() => ({})));
  return { ...info, path: `assets/${kind}/${path.basename(final)}`, kind, size: (await stat(final)).size, converted };
}

function unique(dir: string, name: string): string {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let p = path.join(dir, name);
  for (let i = 2; existsSync(p); i++) p = path.join(dir, `${base}-${i}${ext}`);
  return p;
}

export async function probe(file: string): Promise<MediaInfo> {
  const out = await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]);
  const j = JSON.parse(out) as { format?: { duration?: string }; streams?: { codec_type: string; codec_name: string; width?: number; height?: number; duration?: string }[] };
  const v = j.streams?.find((s) => s.codec_type === "video");
  const a = j.streams?.find((s) => s.codec_type === "audio");
  const d = Number(j.format?.duration ?? v?.duration ?? a?.duration);
  return { duration: Number.isFinite(d) ? Math.round(d * 1000) / 1000 : undefined, width: v?.width, height: v?.height, hasVideo: !!v, hasAudio: !!a, vcodec: v?.codec_name };
}

/** Browser recordings (WebM) have no reliable index or duration. This makes them seekable and frame-exact. */
export async function toMp4(input: string, output: string, withAudio: boolean): Promise<void> {
  const args = ["-v", "error", "-y", "-i", input, "-map", "0:v:0", ...(withAudio ? ["-map", "0:a:0"] : []),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "30",
    "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
    ...(withAudio ? ["-c:a", "aac", "-b:a", "160k", "-ar", "48000"] : []), "-movflags", "+faststart", output];
  await run("ffmpeg", args);
}

/** Small mono MP3 for speech APIs (keeps uploads far below their 25 MB limits). */
export async function speechAudio(input: string, output: string): Promise<void> {
  await run("ffmpeg", ["-v", "error", "-y", "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", output]);
}

export function run(cmd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env } });
    let out = "";
    let err = "";
    p.stdout.on("data", (b: Buffer) => (out += b.toString()));
    p.stderr.on("data", (b: Buffer) => (err = (err + b.toString()).slice(-4000)));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} exited with ${code}: ${err.trim()}`))));
  });
}
