// Self-tuning render: detect the machine, plan workers per export, learn real speed.
//
// Container-aware: in Docker/Coolify the process often gets only part of the host.
// os.cpus() shows the HOST, so we also read the cgroup limits (v1 and v2).

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

export interface Hardware {
  cores: number;
  coresSource: "container" | "system";
  memAvailableGB: number;
  memSource: "container" | "system";
  load1: number;
  gpu: { usable: boolean; name?: string; encoder?: string };
}

export interface RenderPlan {
  workers: number;
  gpu: boolean;
  /** German one-liner for logs and the CLI. The editor formats "info" in its own language. */
  reason: string;
  info?: { cores: number; container: boolean; memGB: number; load: number; limit: "cpu" | "ram" | "cap" | "forced"; gpuName?: string };
}

// ---------- detection ----------

export function parseCpuMax(text: string): number | null {
  const [quota, period] = text.trim().split(/\s+/);
  if (!quota || quota === "max") return null;
  const q = Number(quota), p = Number(period || 100000);
  return q > 0 && p > 0 ? q / p : null;
}

async function read(p: string): Promise<string | null> {
  try { return await readFile(p, "utf8"); } catch { return null; }
}

async function containerCpus(): Promise<number | null> {
  const v2 = await read("/sys/fs/cgroup/cpu.max");
  if (v2) return parseCpuMax(v2);
  const quota = await read("/sys/fs/cgroup/cpu/cpu.cfs_quota_us");
  const period = await read("/sys/fs/cgroup/cpu/cpu.cfs_period_us");
  if (quota && period && Number(quota) > 0) return Number(quota) / Number(period);
  return null;
}

async function containerMemFreeBytes(): Promise<number | null> {
  const lim2 = await read("/sys/fs/cgroup/memory.max");
  const cur2 = await read("/sys/fs/cgroup/memory.current");
  if (lim2 && lim2.trim() !== "max" && cur2) return Number(lim2) - Number(cur2);
  const lim1 = await read("/sys/fs/cgroup/memory/memory.limit_in_bytes");
  const cur1 = await read("/sys/fs/cgroup/memory/memory.usage_in_bytes");
  if (lim1 && cur1 && Number(lim1) < 2 ** 60) return Number(lim1) - Number(cur1);
  return null;
}

async function systemMemAvailableBytes(): Promise<number> {
  const info = await read("/proc/meminfo");
  const m = info && /MemAvailable:\s+(\d+)\s+kB/.exec(info);
  return m ? Number(m[1]) * 1024 : os.freemem();
}

let gpuCache: Hardware["gpu"] | null = null;

/** GPU counts only if a real 1-frame test encode succeeds (FFmpeg lists NVENC even without a GPU). */
async function detectGpu(): Promise<Hardware["gpu"]> {
  if (gpuCache) return gpuCache;
  const force = process.env.OPENMOTION_RENDER_GPU;
  if (force === "0") return (gpuCache = { usable: false });
  const tryEnc = (encoder: string) => ok("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=black:s=256x256:d=0.1", "-frames:v", "1", "-c:v", encoder, "-f", "null", "-"]);
  let name: string | undefined;
  const smi = await capture("nvidia-smi", ["--query-gpu=name", "--format=csv,noheader"]).catch(() => null);
  if (smi) name = smi.split("\n")[0].trim();
  if (name && (await tryEnc("h264_nvenc"))) return (gpuCache = { usable: true, name, encoder: "h264_nvenc" });
  if (os.platform() === "darwin" && (await tryEnc("h264_videotoolbox"))) return (gpuCache = { usable: true, name: "Apple", encoder: "h264_videotoolbox" });
  return (gpuCache = { usable: force === "1", name: force === "1" ? "erzwungen" : undefined });
}

export async function detectHardware(): Promise<Hardware> {
  const sysCores = typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
  const cgCpu = await containerCpus();
  const cores = cgCpu ? Math.max(1, Math.min(sysCores, Math.floor(cgCpu))) : sysCores;
  const sysMem = await systemMemAvailableBytes();
  const cgMem = await containerMemFreeBytes();
  const memBytes = cgMem !== null ? Math.min(cgMem, sysMem) : sysMem;
  return {
    cores,
    coresSource: cgCpu ? "container" : "system",
    memAvailableGB: Math.round((memBytes / 1024 ** 3) * 10) / 10,
    memSource: cgMem !== null && cgMem < sysMem ? "container" : "system",
    load1: Math.round(os.loadavg()[0] * 100) / 100,
    gpu: await detectGpu(),
  };
}

// ---------- planning ----------

/**
 * Workers for ONE export, recomputed before every export:
 *  - CPU: leave one core for the system, subtract what is already busy (load)
 *  - RAM: ~0.5 GB per worker up to 1080p, more for 4K or sharp text; keep 1 GB in reserve
 *  - Cap at 16; OPENMOTION_RENDER_WORKERS overrides everything.
 */
export function planRender(hw: Hardware, job: { height: number; sharpText?: boolean; format?: string }): RenderPlan {
  const forced = Number(process.env.OPENMOTION_RENDER_WORKERS);
  const gpu = hw.gpu.usable && job.format !== "gif";
  if (forced >= 1) return { workers: Math.floor(forced), gpu, reason: `fest eingestellt (OPENMOTION_RENDER_WORKERS=${forced})`, info: { cores: hw.cores, container: hw.coresSource === "container", memGB: hw.memAvailableGB, load: hw.load1, limit: "forced", gpuName: gpu ? hw.gpu.name : undefined } };
  const pixelFactor = ((job.height / 1080) ** 2) * (job.sharpText ? 4 : 1);
  const memPerWorker = 0.5 * Math.max(1, Math.sqrt(pixelFactor));
  const busy = Math.max(0, Math.round(hw.load1));
  const byCpu = Math.max(1, hw.cores - 1 - busy);
  const byMem = Math.max(1, Math.floor((hw.memAvailableGB - 1) / memPerWorker));
  const workers = Math.max(1, Math.min(16, byCpu, byMem));
  const limit = workers === 16 && byCpu > 16 && byMem > 16 ? "Obergrenze 16" : workers === byMem && byMem < byCpu ? "RAM" : "CPU";
  const limitKey: "cpu" | "ram" | "cap" = limit === "RAM" ? "ram" : limit === "CPU" ? "cpu" : "cap";
  return {
    workers,
    gpu,
    info: { cores: hw.cores, container: hw.coresSource === "container", memGB: hw.memAvailableGB, load: hw.load1, limit: limitKey, gpuName: gpu ? hw.gpu.name : undefined },
    reason: `${hw.cores} Kerne${hw.coresSource === "container" ? " (Container)" : ""}, ${hw.memAvailableGB} GB frei, Last ${hw.load1} → ${workers} Worker (begrenzt durch ${limit})${gpu ? `, GPU: ${hw.gpu.name}` : ""}`,
  };
}

// ---------- learning ----------

export interface RenderStats { k?: number; samples: number; last?: { at: string; seconds: number; frames: number; workers: number; height: number } }

/**
 * Work units. Measured: the cost per frame is mostly fixed (capture pipeline, video frames),
 * pixels add only a little (720p ≈ 1.05 × 360p). So: frames × (1 + 0.15 · megapixels),
 * divided by an effective parallel speedup. The scale factor k is learned per machine.
 */
function units(frames: number, height: number, sharp: boolean, workers: number): number {
  const mp = ((height * 16) / 9) * height / 1e6 * (sharp ? 4 : 1);
  return (frames * (1 + 0.15 * mp)) / Math.pow(workers, 0.8);
}

export async function readStats(file?: string): Promise<RenderStats> {
  if (!file || !existsSync(file)) return { samples: 0 };
  try { return JSON.parse(await readFile(file, "utf8")) as RenderStats; } catch { return { samples: 0 }; }
}

/** Exponential moving average of seconds per work unit. Ignores tiny renders (startup dominates). */
export async function recordRender(file: string | undefined, r: { seconds: number; frames: number; workers: number; height: number; sharpText?: boolean }) {
  if (!file || r.frames < 30) return;
  const s = await readStats(file);
  const k = Math.max(0.5, r.seconds - 3) / units(r.frames, r.height, !!r.sharpText, r.workers);
  s.k = s.k ? s.k * 0.6 + k * 0.4 : k;
  s.samples += 1;
  s.last = { at: new Date().toISOString(), seconds: r.seconds, frames: r.frames, workers: r.workers, height: r.height };
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(s, null, 2));
}

/** Estimate in seconds: calibrated from earlier renders, otherwise a careful default. */
export function estimateSeconds(stats: RenderStats, job: { frames: number; height: number; sharpText?: boolean; workers: number }): { seconds: number; calibrated: boolean } {
  const k = stats.k ?? 0.15;
  return { seconds: Math.ceil(3 + k * units(job.frames, job.height, !!job.sharpText, job.workers)), calibrated: !!stats.k };
}

function ok(cmd: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: "ignore" });
    const timer = setTimeout(() => { p.kill(); resolve(false); }, 8000);
    p.on("error", () => { clearTimeout(timer); resolve(false); });
    p.on("close", (c) => { clearTimeout(timer); resolve(c === 0); });
  });
}

function capture(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    p.stdout.on("data", (b: Buffer) => (out += b.toString()));
    p.on("error", reject);
    p.on("close", (c) => (c === 0 ? resolve(out) : reject(new Error(`exit ${c}`))));
  });
}
