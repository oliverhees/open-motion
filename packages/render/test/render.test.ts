import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import type { MotionSpec } from "@openmotion/core";
import { buildComposition, renderVideo, estimate } from "@openmotion/render";

const exampleDir = path.resolve(import.meta.dirname, "../../../examples/explainer");
const example = JSON.parse(readFileSync(path.join(exampleDir, "spec.json"), "utf8")) as MotionSpec;

test("buildComposition writes index.html and copies assets", async () => {
  const out = await mkdtemp(path.join(os.tmpdir(), "om-test-"));
  const r = await buildComposition(example, { specDir: exampleDir, outDir: out });
  assert.ok(existsSync(path.join(out, "index.html")));
  for (const a of r.assets) assert.ok(existsSync(path.join(out, a)), `copied ${a}`);
});

test("missing assets fail with a clear list", async () => {
  const out = await mkdtemp(path.join(os.tmpdir(), "om-test-"));
  const broken = structuredClone(example);
  broken.layers = broken.layers.map((l) => (l.id === "s3-bild" ? { ...l, src: "assets/fehlt.png" } : l)) as MotionSpec["layers"];
  await assert.rejects(buildComposition(broken, { specDir: exampleDir, outDir: out }), /Missing assets[\s\S]*assets\/fehlt\.png/);
});

test("estimate grows with resolution and sharp text", async () => {
  const a = await estimate(example, { height: 720 });
  const b = await estimate(example, { height: 720, sharpText: true });
  assert.equal(a.frames, 390);
  assert.ok(b.seconds > a.seconds);
});

// Real render with headless Chrome. Slow, so opt-in: OM_RENDER_TEST=1 npm test
test("renders a short MP4", { skip: process.env.OM_RENDER_TEST !== "1" }, async () => {
  const spec: MotionSpec = {
    version: 1,
    meta: { title: "Smoke" },
    canvas: { width: 640, height: 360, fps: 15, background: "#102030" },
    scenes: [{ id: "a", name: "A", duration: 1 }],
    layers: [
      { id: "t", type: "text", scene: "a", track: 1, start: 0, duration: 1, frame: { x: 40, y: 40, w: 560, h: 120 }, text: "Rauchtest", style: { fontSize: 64, color: "#fff" }, in: { type: "fade" } },
    ],
  };
  const out = path.join(await mkdtemp(path.join(os.tmpdir(), "om-render-")), "smoke.mp4");
  const r = await renderVideo(spec, { specDir: exampleDir, output: out });
  assert.ok(existsSync(r.output));
  const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out]).stdout.toString();
  assert.ok(Math.abs(Number(probe) - 1) < 0.2);
});

test("cut audio: kept pieces joined with micro fades", async () => {
  const { prepareCutAudio } = await import("@openmotion/render");
  const { applyPatch } = await import("@openmotion/core");
  const cut = applyPatch(example, [{ op: "cut", t0: 2, t1: 3.5 }, { op: "cut", t0: 6, t1: 6.5 }]).spec;
  const work = await mkdtemp(path.join(os.tmpdir(), "om-cut-"));
  const r = await prepareCutAudio(cut, exampleDir, work);
  assert.deepEqual(Object.keys(r.audioOverrides), ["cam-audio"]);
  const file = r.extraFiles["assets/_cut/cam-audio.m4a"];
  const d = Number(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).stdout.toString());
  assert.ok(Math.abs(d - 11) < 0.1, `duration ${d}`);
});
