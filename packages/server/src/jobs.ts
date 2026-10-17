// Export jobs: one render at a time (rendering is CPU-heavy), the rest waits in a queue.

import path from "node:path";
import { randomBytes } from "node:crypto";
import { statSync } from "node:fs";
import { estimate, renderVideo, type RenderOptions, type RenderPlan } from "@openmotion/render";
import type { MotionSpec } from "@openmotion/core";

export interface ExportRequest {
  format: "mp4" | "gif";
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
    const request = sanitize(req);
    const est = await estimate(spec, { height: request.height, fps: request.fps, sharpText: request.sharpText, format: request.format, statsFile: this.statsFile });
    const job: Job = { id: randomBytes(5).toString("hex"), projectId, status: "queued", request, estimateSeconds: est.seconds, plan: est.plan };
    this.jobs.set(job.id, job);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const name = `${projectId}-${request.height}p-${stamp}.${request.format}`;
    this.queue.push(async () => {
      job.status = "running";
      job.startedAt = Date.now();
      try {
        const opts: RenderOptions = { specDir: projectDir, output: path.join(projectDir, "renders", name), ...request, statsFile: this.statsFile };
        const r = await renderVideo(spec, opts);
        job.plan = r.plan;
        job.file = `renders/${name}`;
        job.size = statSync(opts.output).size;
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

export function sanitize(r: Partial<ExportRequest>): ExportRequest {
  const format = r.format === "gif" ? "gif" : "mp4";
  const height = [360, 480, 720, 1080, 1440, 2160].includes(Number(r.height)) ? Number(r.height) : 1080;
  const fps = [15, 24, 25, 30, 50, 60].includes(Number(r.fps)) ? Number(r.fps) : format === "gif" ? 15 : 30;
  const quality = r.quality === "high" || r.quality === "low" ? r.quality : "medium";
  return { format, height, fps, quality, sharpText: Boolean(r.sharpText) && format === "mp4" };
}
