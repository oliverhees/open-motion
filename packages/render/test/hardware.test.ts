import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { estimateSeconds, parseCpuMax, planRender, readStats, recordRender, type Hardware } from "@openmotion/render";

const hw = (o: Partial<Hardware>): Hardware => ({ cores: 8, coresSource: "system", memAvailableGB: 16, memSource: "system", load1: 0, gpu: { usable: false }, ...o });

test("container CPU limits are read correctly", () => {
  assert.equal(parseCpuMax("200000 100000"), 2);
  assert.equal(parseCpuMax("150000 100000"), 1.5);
  assert.equal(parseCpuMax("max 100000"), null);
});

test("plan adapts to cores, RAM, load, resolution and GPU", () => {
  assert.equal(planRender(hw({}), { height: 1080 }).workers, 7);
  assert.equal(planRender(hw({ cores: 1 }), { height: 1080 }).workers, 1);
  const ram = planRender(hw({ cores: 32, memAvailableGB: 4 }), { height: 1080 });
  assert.equal(ram.workers, 6);
  assert.match(ram.reason, /begrenzt durch RAM/);
  assert.equal(planRender(hw({ cores: 32, memAvailableGB: 8 }), { height: 2160, sharpText: true }).workers, 3, "4K + sharp text needs more RAM per worker");
  assert.equal(planRender(hw({ load1: 3 }), { height: 1080 }).workers, 4, "busy machine → fewer workers");
  assert.equal(planRender(hw({ cores: 64, memAvailableGB: 128 }), { height: 1080 }).workers, 16);
  assert.equal(planRender(hw({ gpu: { usable: true, name: "RTX" } }), { height: 1080 }).gpu, true);
  assert.equal(planRender(hw({ gpu: { usable: true, name: "RTX" } }), { height: 1080, format: "gif" }).gpu, false);
  process.env.OPENMOTION_RENDER_WORKERS = "3";
  assert.equal(planRender(hw({}), { height: 1080 }).workers, 3);
  delete process.env.OPENMOTION_RENDER_WORKERS;
});

test("estimate learns from real renders", async () => {
  const file = path.join(await mkdtemp(path.join(os.tmpdir(), "om-stats-")), "render-stats.json");
  const job = { frames: 390, height: 720, workers: 1 };
  const first = estimateSeconds(await readStats(file), job);
  assert.equal(first.calibrated, false);
  await recordRender(file, { seconds: 75, ...job });
  await recordRender(file, { seconds: 73, ...job });
  const learned = estimateSeconds(await readStats(file), job);
  assert.equal(learned.calibrated, true);
  assert.ok(Math.abs(learned.seconds - 74) <= 2, `learned ${learned.seconds}s`);
  const faster = estimateSeconds(await readStats(file), { ...job, workers: 4 });
  assert.ok(faster.seconds < learned.seconds / 2, "more workers → shorter estimate");
});
