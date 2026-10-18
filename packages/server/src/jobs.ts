// Export jobs: one render at a time (rendering is CPU-heavy), the rest waits in a queue.

import path from "node:path";
import { randomBytes } from "node:crypto";
import { statSync } from "node:fs";
import { estimate, renderVideo, type RenderOptions, type RenderPlan } from "@openmotion/render";
import { backgroundLayers, type MotionSpec } from "@openmotion/core";

export const EXPORT_FORMATS = ["mp4", "gif", "webm", "mov", "lottie"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
/** Formats that keep transparency. */
export const ALPHA_FORMATS: readonly ExportFormat[] = ["webm", "mov", "lottie"];

export interface ExportRequest {
  format: ExportFormat;
  /** webm/mov/lottie: transparent background (default true). */
  transparent?: boolean;
  /** Layer ids left out. Default for transparent exports: full-canvas background shapes. */
  hide?: string[];
  height: number;
  fps: number;
  quality: "high" | "medium" | "low";
  sharpText: boolean;
}

export interface Job {
  id: string;
  projectId: string;
  status: "queued" | "running" | "done" | "error";
  request: ExportRequest;
  estimateSeconds: number;
  plan?: RenderPlan;
  startedAt?: number;
  finishedAt?: number;
  file?: string;
  size?: number;
  error?: string;
  warnings?: { code: string; layers: string[] }[];
}

export class Jobs {
  private jobs = new Map<string, Job>();
  readonly statsFile?: string;
  constructor(statsFile?: string) {
    this.statsFile = statsFile;
  }
  private queue: (() => Promise<void>)[] = [];
  private busy = false;

  async start(projectId: string, projectDir: string, spec: MotionSpec, req: ExportRequest): Promise<Job> {
    const request = withDefaults(sanitize(req), spec);
    const est = await estimate(spec, { height: request.height, fps: request.fps, sharpText: request.sharpText, format: request.format, statsFile: this.statsFile });
    const job: Job = { id: randomBytes(5).toString("hex"), projectId, status: "queued", request, estimateSeconds: est.seconds, plan: est.plan };
    this.jobs.set(job.id, job);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const name = exportName(projectId, request, stamp);
    this.queue.push(async () => {
      job.status = "running";
      job.startedAt = Date.now();
      try {
        const opts: RenderOptions = { specDir: projectDir, output: path.join(projectDir, "renders", name), ...request, statsFile: this.statsFile };
        const r = await renderVideo(spec, opts);
        job.plan = r.plan;
        job.file = `renders/${name}`;
        job.size = statSync(opts.output).size;
        if (r.warnings?.length) job.warnings = r.warnings;
        job.status = "done";
      } catch (e) {
        job.status = "error";
        job.error = (e as Error).message.slice(0, 2000);
      } finally {
        job.finishedAt = Date.now();
      }
    });
    void this.pump();
    return job;
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  private async pump() {
    if (this.busy) return;
    this.busy = true;
    while (this.queue.length) await this.queue.shift()!();
    this.busy = false;
  }
}

/** File name of an export: Lottie is a .json, everything else carries its height. */
export function exportName(projectId: string, r: ExportRequest, stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")): string {
  return r.format === "lottie" ? `${projectId}-lottie-${stamp}.json` : `${projectId}-${r.height}p${r.transparent ? "-alpha" : ""}-${stamp}.${r.format}`;
}

/** Fills in the background layers to hide for a transparent export when the caller did not choose. */
export function withDefaults(r: ExportRequest, spec: MotionSpec): ExportRequest {
  if (!r.transparent || r.hide) return r;
  return { ...r, hide: backgroundLayers(spec).filter((b) => b.hideByDefault).map((b) => b.id) };
}

export function sanitize(r: Partial<ExportRequest>): ExportRequest {
  const format: ExportFormat = (EXPORT_FORMATS as readonly string[]).includes(r.format as string) ? (r.format as ExportFormat) : "mp4";
  const alpha = ALPHA_FORMATS.includes(format);
  const hide = Array.isArray(r.hide) ? r.hide.filter((x) => typeof x === "string" && x.length <= 80).slice(0, 500) : undefined;
  const height = [360, 480, 720, 1080, 1440, 2160].includes(Number(r.height)) ? Number(r.height) : 1080;
  const fps = [15, 24, 25, 30, 50, 60].includes(Number(r.fps)) ? Number(r.fps) : format === "gif" ? 15 : 30;
  const quality = r.quality === "high" || r.quality === "low" ? r.quality : "medium";
  return { format, height, fps, quality, sharpText: Boolean(r.sharpText) && format === "mp4", transparent: alpha && r.transparent !== false, ...(hide ? { hide } : {}) };
}
