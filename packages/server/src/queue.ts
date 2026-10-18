// Job queue between the editor service and the render worker(s). Plain files in the shared data volume:
//   data/queue/jobs/<id>.json    state of a job
//   data/queue/locks/<id>.lock   created with O_EXCL → exactly one worker gets the job, even across containers
// No Redis, no database. Several workers can share one queue.

import { existsSync } from "node:fs";
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

/** dictate: short voice input for chat/interview, always taken before exports. */
export type JobType = "export" | "transcribe" | "dictate";
export interface QueueJob<P = any, R = any> {
  id: string;
  type: JobType;
  status: "queued" | "running" | "done" | "error";
  projectId?: string;
  payload: P;
  result?: R;
  error?: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  worker?: string;
  [extra: string]: unknown;
}

export class FileQueue {
  readonly dir: string;
  constructor(dataDir: string) {
    this.dir = path.resolve(dataDir, "queue");
  }
  private jobFile(id: string) {
    if (!/^[a-f0-9]{10}$/.test(id)) throw new Error("bad job id");
    return path.join(this.dir, "jobs", `${id}.json`);
  }

  async enqueue<P>(type: JobType, payload: P, extra: Record<string, unknown> = {}): Promise<QueueJob<P>> {
    await mkdir(path.join(this.dir, "jobs"), { recursive: true });
    await mkdir(path.join(this.dir, "locks"), { recursive: true });
    const job: QueueJob<P> = { id: randomBytes(5).toString("hex"), type, status: "queued", payload, createdAt: Date.now(), ...extra };
    await this.write(job);
    return job;
  }

  async get(id: string): Promise<QueueJob | undefined> {
    try {
      return JSON.parse(await readFile(this.jobFile(id), "utf8")) as QueueJob;
    } catch {
      return undefined;
    }
  }

  async update(id: string, patch: Partial<QueueJob>): Promise<QueueJob> {
    const cur = await this.get(id);
    if (!cur) throw new Error(`job ${id} not found`);
    const next = { ...cur, ...patch };
    await this.write(next);
    return next;
  }

  /** Oldest queued job of the given types, claimed atomically. */
  async claim(types: JobType[], worker: string): Promise<QueueJob | undefined> {
    const dir = path.join(this.dir, "jobs");
    if (!existsSync(dir)) return undefined;
    const jobs: QueueJob[] = [];
    for (const f of await readdir(dir)) {
      if (!f.endsWith(".json")) continue;
      const j = await this.get(f.slice(0, -5));
      if (j && j.status === "queued" && types.includes(j.type)) jobs.push(j);
    }
    jobs.sort((a, b) => a.createdAt - b.createdAt);
    for (const j of jobs) {
      try {
        const fh = await open(path.join(this.dir, "locks", `${j.id}.lock`), "wx");
        await fh.writeFile(worker);
        await fh.close();
      } catch {
        continue;
      }
      return this.update(j.id, { status: "running", startedAt: Date.now(), worker });
    }
    return undefined;
  }

  /** Jobs whose worker died (running, but no progress for a long time) go back to the queue. */
  async requeueStale(maxMs = 6 * 3600_000) {
    const dir = path.join(this.dir, "jobs");
    if (!existsSync(dir)) return;
    for (const f of await readdir(dir)) {
      const j = await this.get(f.replace(/\.json$/, ""));
      if (j?.status === "running" && Date.now() - (j.startedAt ?? 0) > maxMs) {
        await rm(path.join(this.dir, "locks", `${j.id}.lock`), { force: true });
        await this.update(j.id, { status: "queued", worker: undefined });
      }
    }
  }

  async cleanup(maxAgeMs = 7 * 86_400_000) {
    const dir = path.join(this.dir, "jobs");
    if (!existsSync(dir)) return;
    for (const f of await readdir(dir)) {
      const p = path.join(dir, f);
      if (Date.now() - (await stat(p)).mtimeMs > maxAgeMs) {
        await rm(p, { force: true });
        await rm(path.join(this.dir, "locks", f.replace(/\.json$/, ".lock")), { force: true });
      }
    }
  }

  private async write(job: QueueJob) {
    const file = this.jobFile(job.id);
    const tmp = `${file}.${randomBytes(3).toString("hex")}.tmp`;
    await writeFile(tmp, JSON.stringify(job));
    await rename(tmp, file);
  }
}
