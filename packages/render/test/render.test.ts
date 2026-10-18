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

test("font metrics come from the font file (woff2), used to place Lottie text like the browser", async () => {
  const { fontMetrics } = await import("@openmotion/render");
  const m = fontMetrics(readFileSync(path.join(exampleDir, "assets/fonts/bricolage-grotesque-latin.woff2")));
  assert.ok(m, "metrics read");
  assert.ok(m!.ascent > 0.7 && m!.ascent < 1.3, `ascent ${m!.ascent}`);
  assert.ok(m!.descent > 0.1 && m!.descent < 0.5, `descent ${m!.descent}`);
  assert.equal(fontMetrics(Buffer.from("not a font")), null);
});

test("lottie export: one JSON with embedded images and warnings, no render needed", async () => {
  const out = path.join(await mkdtemp(path.join(os.tmpdir(), "om-test-")), "x.json");
  const r = await renderVideo(example, { specDir: exampleDir, output: out, format: "lottie", hide: ["bg"] });
  const json = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(json.w, example.canvas.width);
  assert.ok(json.assets.some((a: { p: string }) => a.p.startsWith("data:image/png;base64,")), "image embedded");
  assert.ok(r.warnings?.some((w) => w.code === "video"), "facecam video reported as missing");
});

test("renders a transparent WebM", { skip: process.env.OM_RENDER_TEST !== "1" }, async () => {
  const out = path.join(await mkdtemp(path.join(os.tmpdir(), "om-test-")), "x.webm");
  const spec: MotionSpec = { version: 1, meta: { title: "a" }, canvas: { width: 320, height: 180, fps: 10, background: "#000" }, scenes: [{ id: "s", name: "s", duration: 1 }],
    layers: [{ id: "b", type: "shape", shape: "rect", track: 1, start: 0, duration: 1, frame: { x: 100, y: 50, w: 100, h: 80 }, fill: "#ff0000" }] };
  await renderVideo(spec, { specDir: exampleDir, output: out, format: "webm", transparent: true });
  const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream_tags=alpha_mode", "-of", "csv=p=0", out], { encoding: "utf8" });
  assert.match(probe.stdout, /1/, "VP9 with alpha");
});
