// Background tasks (transcription): one at a time, CPU-heavy work never piles up.
import { randomBytes } from "node:crypto";

export interface Task<T = unknown> { id: string; kind: string; status: "queued" | "running" | "done" | "error"; result?: T; error?: string; startedAt?: number; finishedAt?: number }

export class Tasks {
  private map = new Map<string, Task>();
  private queue: (() => Promise<void>)[] = [];
  private busy = false;

  start<T>(kind: string, fn: () => Promise<T>): Task<T> {
    const task: Task<T> = { id: randomBytes(5).toString("hex"), kind, status: "queued" };
    this.map.set(task.id, task);
    this.queue.push(async () => {
      task.status = "running";
      task.startedAt = Date.now();
      try {
        task.result = await fn();
        task.status = "done";
      } catch (e) {
        task.status = "error";
        task.error = (e as Error).message.slice(0, 2000);
      } finally {
        task.finishedAt = Date.now();
      }
    });
    void this.pump();
    return task;
  }

  get(id: string): Task | undefined {
    return this.map.get(id);
  }

  private async pump() {
    if (this.busy) return;
    this.busy = true;
    while (this.queue.length) await this.queue.shift()!();
    this.busy = false;
  }
}
