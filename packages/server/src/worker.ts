// Render worker: takes export and transcription jobs from the shared queue.
// Runs as its own container (OPENMOTION_ROLE=worker) or inside the app process (role "all", local use).

import os from "node:os";
import path from "node:path";
import { statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { renderVideo, detectHardware, type RenderOptions } from "@openmotion/render";
import type { MotionSpec } from "@openmotion/core";
import { FileQueue, type QueueJob } from "./queue.ts";
import { SettingsStore, type Provider } from "./settings.ts";
import { localAvailable, transcribe, withIds } from "./transcribe.ts";
import type { ExportRequest } from "./jobs.ts";

export interface WorkerInfo { at: string; id: string; host: string; busy: string | null; localWhisper: boolean; hardware: Awaited<ReturnType<typeof detectHardware>> }

export function workerFile(dataDir: string) {
  return path.resolve(dataDir, "worker.json");
}

export async function runWorker(dataDir: string, signal?: AbortSignal) {
  const queue = new FileQueue(dataDir);
  const settings = new SettingsStore(dataDir);
  const id = `${os.hostname()}-${process.pid}`;
  const statsFile = path.resolve(dataDir, "render-stats.json");
  let busy: string | null = null;
  const local = await localAvailable();
  const beat = async () => {
    const info: WorkerInfo = { at: new Date().toISOString(), id, host: os.hostname(), busy, localWhisper: local, hardware: await detectHardware() };
    await writeFile(workerFile(dataDir), JSON.stringify(info, null, 2)).catch(() => {});
  };
  await beat();
  const hb = setInterval(() => void beat(), 10_000);
  const housekeeping = setInterval(() => { void queue.requeueStale(); void queue.cleanup(); }, 3600_000);
  console.log(`Render-Worker ${id} bereit (lokales Whisper: ${local ? "ja" : "nein"})`);

  try {
    while (!signal?.aborted) {
      const job = await queue.claim(["export", "transcribe"], id).catch(() => undefined);
      if (!job) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      busy = job.id;
      void beat();
      try {
        const result = job.type === "export" ? await doExport(job, dataDir, statsFile, queue) : await doTranscribe(job, dataDir, await settings.read());
        await queue.update(job.id, { status: "done", finishedAt: Date.now(), result, ...(job.type === "export" ? (result as object) : {}) });
      } catch (e) {
        await queue.update(job.id, { status: "error", finishedAt: Date.now(), error: (e as Error).message.slice(0, 2000) });
      } finally {
        busy = null;
        void beat();
      }
    }
  } finally {
    clearInterval(hb);
    clearInterval(housekeeping);
  }
}

async function doExport(job: QueueJob<{ projectId: string; spec: MotionSpec; request: ExportRequest; name: string }>, dataDir: string, statsFile: string, queue: FileQueue) {
  const { projectId, spec, request, name } = job.payload;
  const dir = path.resolve(dataDir, "projects", projectId);
  const opts: RenderOptions = { specDir: dir, output: path.join(dir, "renders", name), ...request, statsFile };
  const r = await renderVideo(spec, opts);
  await queue.update(job.id, { plan: r.plan });
  return { file: `renders/${name}`, size: statSync(opts.output).size, plan: r.plan };
}

async function doTranscribe(job: QueueJob<{ projectId: string; source: string; provider?: Provider; language?: string; model?: string }>, dataDir: string, s: Awaited<ReturnType<SettingsStore["read"]>>) {
  const p = job.payload;
  const dir = path.resolve(dataDir, "projects", p.projectId);
  const file = path.resolve(dir, p.source);
  if (!file.startsWith(path.join(dir, "assets") + path.sep)) throw new Error("source muss unter assets/ liegen");
  const r = await transcribe(file, s, { provider: p.provider, language: p.language, model: p.model, modelsDir: path.resolve(dataDir, "models") });
  return { source: p.source, language: r.language, provider: `${r.provider}:${r.model}`, words: withIds(r.words) };
}
