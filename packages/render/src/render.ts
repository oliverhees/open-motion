// renderVideo(): Motion-Spec → MP4 or GIF via HyperFrames (headless Chrome + FFmpeg).
// Options mirror an export dialog: format, resolution, frame rate, quality, sharper text.

import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rename, rm, copyFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { compositionDuration, isCutLayer, keptSegments, type MotionSpec } from "@openmotion/core";
import { buildComposition } from "./build.ts";
import { detectHardware, estimateSeconds, planRender, readStats, recordRender, type RenderPlan } from "./hardware.ts";

export interface RenderOptions {
  specDir: string;
  output: string;
  format?: "mp4" | "gif";
  /** Output height in px (720, 1080, 2160 …). Default: canvas height. */
  height?: number;
  fps?: number;
  quality?: "high" | "medium" | "low";
  /** Render at 2× and scale down: crisper text, slower. */
  sharpText?: boolean;
  /** Keep the built composition folder (for debugging). */
  keepBuild?: boolean;
  /** Fixed worker count. Default: planned automatically from the detected hardware. */
  workers?: number;
  /** Where measured render speed is stored, so estimates improve over time. */
  statsFile?: string;
  onLog?: (line: string) => void;
}

export interface RenderResult {
  output: string;
  width: number;
  height: number;
  duration: number;
  seconds: number;
  plan: RenderPlan;
}

const CRF = { high: 16, medium: 21, low: 27 } as const;

export async function renderVideo(spec: MotionSpec, opts: RenderOptions): Promise<RenderResult> {
  const began = Date.now();
  const format = opts.format ?? "mp4";
  const fps = opts.fps ?? (format === "gif" ? 15 : spec.canvas.fps);
  const targetH = opts.height ?? spec.canvas.height;
  const scale = targetH / spec.canvas.height;
  const sharp = Boolean(opts.sharpText) && format === "mp4";
  const work = await mkdtemp(path.join(os.tmpdir(), "openmotion-"));
  const dir = path.join(work, "composition");
  const cut = await prepareCutAudio(spec, opts.specDir, work);
  const built = await buildComposition(spec, { specDir: opts.specDir, outDir: dir, scale: sharp ? scale * 2 : scale, ...cut });
  const raw = path.join(work, format === "gif" ? "raw.gif" : "raw.mp4");

  const plan: RenderPlan = opts.workers
    ? { workers: opts.workers, gpu: false, reason: `fest: ${opts.workers} Worker` }
    : planRender(await detectHardware(), { height: targetH, sharpText: sharp, format });
  opts.onLog?.(`Plan: ${plan.reason}`);
  const args = ["render", dir, "-o", raw, "--fps", String(fps), "--quiet", "--workers", String(plan.workers)];
  if (plan.gpu) args.push("--gpu");
  if (format === "gif") args.push("--format", "gif");
  else args.push("--crf", String(CRF[opts.quality ?? "medium"]));
  await run(process.execPath, [hyperframesBin(), ...args], opts.onLog);

  const output = path.resolve(opts.output);
  let width = built.width;
  let height = built.height;
  if (sharp) {
    width = even(built.width / 2);
    height = even(built.height / 2);
    await run("ffmpeg", ["-v", "error", "-y", "-i", raw, "-vf", `scale=${width}:${height}:flags=lanczos`, "-c:v", "libx264", "-pix_fmt", "yuv420p",
      "-crf", String(CRF[opts.quality ?? "medium"]), "-c:a", "copy", "-movflags", "+faststart", output], opts.onLog);
  } else {
    await moveFile(raw, output);
  }
  if (opts.keepBuild) opts.onLog?.(`Composition kept at ${dir}`);
  else await rm(work, { recursive: true, force: true });
  const seconds = Math.round((Date.now() - began) / 100) / 10;
  await recordRender(opts.statsFile, { seconds, frames: Math.ceil(built.duration * fps - 1e-6), workers: plan.workers, height: targetH, sharpText: sharp }).catch(() => {});
  return { output, width, height, duration: built.duration, seconds, plan };
}

/**
 * Click-free cuts: for every cut audio layer, FFmpeg joins the kept pieces into one file
 * with a 10 ms fade at every edge. The editor preview plays the raw segments instead.
 */
export async function prepareCutAudio(spec: MotionSpec, specDir: string, work: string) {
  const audioOverrides: Record<string, string> = {};
  const extraFiles: Record<string, string> = {};
  const F = 0.01;
  for (const layer of spec.layers) {
    if (layer.type !== "audio" || layer.hidden || !isCutLayer(spec, layer)) continue;
    const segs = keptSegments(spec, layer);
    if (!segs.length) continue;
    const parts = segs.map((sg, i) => {
      const len = sg.src1 - sg.src0;
      const f = Math.min(F, len / 3);
      return `[0:a]atrim=start=${sg.src0}:end=${sg.src1},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${f},afade=t=out:st=${Math.max(0, len - f).toFixed(4)}:d=${f}[a${i}]`;
    });
    const filter = `${parts.join(";")};${segs.map((_, i) => `[a${i}]`).join("")}concat=n=${segs.length}:v=0:a=1[out]`;
    const rel = `assets/_cut/${layer.id}.m4a`;
    const abs = path.join(work, "cut", `${layer.id}.m4a`);
    await mkdir(path.dirname(abs), { recursive: true });
    await run("ffmpeg", ["-v", "error", "-y", "-i", path.resolve(specDir, layer.src), "-filter_complex", filter, "-map", "[out]", "-c:a", "aac", "-b:a", "192k", abs]);
    audioOverrides[layer.id] = rel;
    extraFiles[rel] = abs;
  }
  return { audioOverrides, extraFiles };
}

/** Export estimate from detected hardware and measured speed of earlier renders. */
export async function estimate(spec: MotionSpec, opts: Pick<RenderOptions, "height" | "fps" | "sharpText" | "format" | "statsFile" | "workers"> & { hardware?: Awaited<ReturnType<typeof detectHardware>> }) {
  const height = opts.height ?? spec.canvas.height;
  const fps = opts.fps ?? (opts.format === "gif" ? 15 : spec.canvas.fps);
  const frames = Math.ceil(compositionDuration(spec) * fps - 1e-6);
  const hw = opts.hardware ?? (await detectHardware());
  const plan = opts.workers ? { workers: opts.workers, gpu: false, reason: `fest: ${opts.workers} Worker` } : planRender(hw, { height, sharpText: opts.sharpText, format: opts.format });
  const est = estimateSeconds(await readStats(opts.statsFile), { frames, height, sharpText: opts.sharpText, workers: plan.workers });
  return { frames, seconds: est.seconds, calibrated: est.calibrated, plan, hardware: hw };
}

function hyperframesBin(): string {
  const require = createRequire(import.meta.url);
  const pkgPath = require.resolve("hyperframes/package.json");
  const pkg = require(pkgPath) as { bin: string | Record<string, string> };
  const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin.hyperframes;
  return path.join(path.dirname(pkgPath), bin);
}

function run(cmd: string, args: string[], onLog?: (l: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      env: { ...process.env, HYPERFRAMES_SKIP_SKILLS: "1", HYPERFRAMES_NO_TELEMETRY: "1", DO_NOT_TRACK: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let tail = "";
    const onData = (b: Buffer) => {
      const s = b.toString();
      tail = (tail + s).slice(-4000);
      s.split("\n").filter(Boolean).forEach((l) => onLog?.(l));
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} exited with ${code}\n${tail}`))));
  });
}

async function moveFile(from: string, to: string) {
  try {
    await rename(from, to);
  } catch {
    await copyFile(from, to);
  }
}

const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
