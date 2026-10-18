// Motion engine 2: kinetic type, highlights, counters, self-drawing SVG, looks, masks, camera, texture, new eases.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyPatch, compile, cssEasing, getEase, validateSpec, type Layer, type MotionSpec } from "@openmotion/core";

const base = (layers: Layer[], extra: Partial<MotionSpec> = {}): MotionSpec => ({
  version: 1,
  meta: { title: "fx", lang: "de" },
  canvas: { width: 1920, height: 1080, fps: 30, background: "#000" },
  style: { palette: { accent: "#ff6a3d", ink: "#ffffff" } },
  scenes: [],
  layers,
  ...extra,
});
const text = (over: Partial<Extract<Layer, { type: "text" }>> = {}): Layer => ({
  id: "t", type: "text", track: 1, start: 1, duration: 4, frame: { x: 0, y: 0, w: 800, h: 200 }, text: "Hallo [[schöne]] Welt", style: { fontSize: 80 }, ...over,
} as Layer);

test("eases: spring settles without overshoot, spring.soft overshoots a little, steps are steps", () => {
  const sp = getEase("spring");
  const soft = getEase("spring.soft");
  const samples = Array.from({ length: 101 }, (_, i) => i / 100);
  assert.ok(samples.every((p) => sp(p) <= 1.0001));
  const peak = Math.max(...samples.map(soft));
  assert.ok(peak > 1.01 && peak < 1.08, `soft spring peak ${peak}`);
  assert.equal(getEase("steps(4)")(0.3), 0.25);
  assert.equal(cssEasing("steps(8)"), "steps(8, end)");
  assert.equal(sp(0), 0);
  assert.equal(sp(1), 1);
});

test("kinetic text: one animated piece per word, stagger and mask wrapper, [[highlight]] in accent", () => {
  const c = compile(base([text({ anim: { type: "mask", stagger: 0.1, duration: 0.5 } })]));
  const pieces = c.anims.filter((a) => a[0].startsWith("om-p-t-"));
  assert.equal(pieces.length, 3);
  assert.deepEqual(pieces.map((a) => a[2]), [1000, 1100, 1200]);
  assert.equal(pieces[0][3], 500);
  assert.match(c.html, /<span class="om-m"><span id="om-p-t-1" class="om-p"><span id="om-p-t-1-h" class="om-hl" style="color:var\(--om-accent\)/);
  assert.match(c.html, /schöne<\/span><\/span><\/span> /);
});

test("kinetic text: order center/random is deterministic, chars split, plain text stays plain", () => {
  const c1 = compile(base([text({ text: "abcde", anim: { by: "char", type: "fade", order: "center", stagger: 1 } })]));
  const d1 = c1.anims.filter((a) => a[0].startsWith("om-p-t-")).map((a) => a[2] - 1000);
  assert.deepEqual(d1, [4000, 2000, 0, 2000, 4000]);
  const r1 = compile(base([text({ text: "a b c d e f", anim: { type: "fade", order: "random" } })])).anims.map((a) => a[2]);
  const r2 = compile(base([text({ text: "a b c d e f", anim: { type: "fade", order: "random" } })])).anims.map((a) => a[2]);
  assert.deepEqual(r1, r2);
  const plain = compile(base([text({ text: "Nur Text" })]));
  assert.match(plain.html, />Nur Text<\/div>/);
});

test("counter: registered integer property, decimals via CSS counters, German decimal comma", () => {
  const c = compile(base([text({ text: "", count: { from: 0, to: 98.5, decimals: 1, suffix: " %", duration: 2 } })]));
  assert.match(c.html, /@property --om-n-t\{syntax:"<integer>"/);
  assert.match(c.html, /counter\(omi\) "," counter\(omf\) "\u00a0%"/, "unit glued with a non-breaking space");
  const a = c.anims.find((x) => x[0] === "om-n-t")!;
  assert.deepEqual([a[1][0]["--om-n-t"], a[1][1]["--om-n-t"], a[2], a[3]], [0, 985, 1000, 2000]);
});

test("svg draw: every shape gets pathLength=1 and a stroke animation, staggered", () => {
  const svg: Layer = { id: "s", type: "svg", track: 1, start: 0, duration: 3, frame: { x: 0, y: 0, w: 100, h: 100 }, svg: "<path d='M0 0L10 10' stroke='red'/><circle cx='5' cy='5' r='3'/>", draw: { duration: 1, stagger: 0.2 } };
  const c = compile(base([svg]));
  assert.match(c.html, /<path id="om-d-s-0" pathLength="1" stroke-dasharray="1" d=/);
  assert.match(c.html, /<circle id="om-d-s-1" pathLength="1"/);
  const d = c.anims.filter((a) => a[0].startsWith("om-d-s-"));
  assert.deepEqual(d.map((a) => a[2]), [0, 200]);
  assert.equal(d[0][1][0].strokeDashoffset, 1);
});

test("look: shadow + glow + glass on the content, blend on the frame, palette inside gradients", () => {
  const shape: Layer = { id: "g", type: "shape", track: 1, start: 0, duration: 3, frame: { x: 0, y: 0, w: 100, h: 100 }, shape: "rect", fill: "linear-gradient(90deg, $accent, #000)", look: { shadow: "0 20px 40px #0008", glow: "$accent", glass: 20, blend: "screen" } };
  const c = compile(base([shape]), { scale: 0.5 });
  assert.match(c.html, /mix-blend-mode:screen/);
  assert.match(c.html, /background:linear-gradient\(90deg, var\(--om-accent\), #000\)/);
  assert.match(c.html, /filter:drop-shadow\(0 10px 20px #0008\) drop-shadow\(0 0 6px var\(--om-accent\)\)/);
  assert.match(c.html, /backdrop-filter:blur\(10px\)/);
});

test("masks: wipes from every side and iris; at rest the mask is switched off (glow/glass stay intact)", () => {
  const sh = (tr: string): Layer => ({ id: tr, type: "shape", track: 1, start: 0, duration: 4, frame: { x: 0, y: 0, w: 100, h: 100 }, shape: "rect", fill: "#fff", in: { type: tr as never, duration: 1 }, out: { type: "wipe", duration: 1 } });
  const c = compile(base([sh("wipeUp"), sh("iris")]));
  const up = c.anims.find((a) => a[0] === "om-fx-wipeUp" && "clipPath" in a[1][0])!;
  const vals = up[1].map((f) => f.clipPath);
  assert.equal(vals[0], "inset(100% 0% 0% 0%)");
  assert.ok(vals.includes("none"), "mask off while resting");
  assert.equal(vals.at(-1), "inset(0% 100% 0% 0%)");
  const iris = c.anims.find((a) => a[0] === "om-fx-iris" && "clipPath" in a[1][0])!;
  assert.equal(iris[1][0].clipPath, "circle(0% at 50% 50%)");
});

test("3D tilt and blur keys: rotateX + rotateY merged into one transform animation", () => {
  const card: Layer = { id: "c", type: "shape", track: 1, start: 1, duration: 4, frame: { x: 0, y: 0, w: 100, h: 100, rotateX: 10 }, shape: "rect", keys: { rotateY: [{ t: 0, v: -20 }, { t: 2, v: 0 }], blur: [{ t: 0, v: 8 }, { t: 1, v: 0 }] } };
  const c = compile(base([card]));
  const tr = c.anims.find((a) => a[0] === "om-c" && "transform" in a[1][0])!;
  assert.equal(tr[1][0].transform, "perspective(1400px) rotateX(10deg) rotateY(-20deg)");
  assert.equal(tr[1].at(-1)!.transform, "perspective(1400px) rotateX(10deg) rotateY(0deg)");
  assert.equal(tr[2], 1000);
  const bl = c.anims.find((a) => a[0] === "om-c" && "filter" in a[1][0])!;
  assert.deepEqual([bl[1][0].filter, bl[1][1].filter], ["blur(8px)", "none"]);
});

test("camera: content in a zoom/pan box, fixed layers outside it, set through a patch", () => {
  const spec = base([
    { id: "bg", type: "shape", track: 1, start: 0, duration: 4, frame: { x: 0, y: 0, w: 1920, h: 1080 }, shape: "rect", fill: "#111" },
    { id: "cam2", type: "shape", track: 9, start: 0, duration: 4, frame: { x: 0, y: 0, w: 300, h: 300 }, shape: "ellipse", fill: "#fff", fixed: true },
  ]);
  const r = applyPatch(spec, [{ op: "camera", set: { keys: { zoom: [{ t: 0, v: 1 }, { t: 4, v: 1.2 }], x: [{ t: 0, v: 0 }, { t: 4, v: 200 }] } } }]);
  const c = compile(r.spec);
  const camAt = c.html.indexOf('<div id="om-cam"');
  assert.ok(camAt > 0 && c.html.indexOf('id="om-bg"') > camAt && c.html.indexOf('id="om-cam2"') > c.html.indexOf("</div>\n", c.html.indexOf('id="om-bg"')));
  const zoom = c.anims.find((a) => a[0] === "om-cam" && "scale" in a[1][0])!;
  assert.deepEqual([zoom[1][0].scale, zoom[1][1].scale], [1, 1.2]);
  const pan = c.anims.find((a) => a[0] === "om-cam" && "transform" in a[1][0])!;
  assert.equal(pan[1][0].transform, "translate(-960px, -540px)");
  assert.equal(pan[1].at(-1)!.transform, "translate(-1160px, -540px)");
  assert.throws(() => applyPatch(spec, [{ op: "camera", set: { keys: { zoom: [{ t: 2, v: 1 }, { t: 1, v: 2 }] } } }]), /camera.keys.zoom must be sorted/);
  assert.equal(applyPatch(r.spec, [{ op: "camera", set: null }]).spec.camera, undefined);
});

test("texture: grain moves deterministically in steps, vignette and scanlines on top", () => {
  const c = compile(base([text()], { canvas: { width: 1920, height: 1080, fps: 30, texture: { scanlines: 0.3 } } }));
  assert.match(c.html, /repeating-linear-gradient\(0deg/);
  const c2 = compile(base([text()], { canvas: { width: 1920, height: 1080, fps: 30, texture: { grain: 0.5, vignette: 0.5 } } }));
  const g2 = c2.anims.find((a) => a[0] === "om-grain")!;
  assert.equal(g2[1][0].easing, "steps(60, end)");
  assert.match(c2.html, /radial-gradient\(ellipse at 50% 50%, transparent 52%, rgba\(0,0,0,0.4\) 100%\)/);
});

test("validation: CSS injection in looks is refused, unknown palette names inside gradients are caught", () => {
  const bad = validateSpec(base([text({ look: { shadow: "0 0 4px red; background:url(x)" } })]));
  assert.ok(!bad.ok);
  assert.match(bad.errors.join("\n"), /plain CSS value only/);
  const pal = validateSpec(base([text({ style: { fontSize: 40, gradient: "linear-gradient($nope, #fff)" } })]));
  assert.match(pal.errors.join("\n"), /color "\$nope" is not in style.palette/);
});

test("captions: phrases from the transcript (cut words skipped), active word lights up, follows cuts", () => {
  const spec = base([
    { id: "cam", type: "video", track: 1, start: 0, duration: 10, frame: { x: 0, y: 0, w: 1920, h: 1080 }, src: "assets/video/f.mp4" },
    { id: "cap", type: "captions", track: 9, start: 0, duration: 10, frame: { x: 0, y: 800, w: 1920, h: 200 }, style: { fontSize: 60 }, words: 2, active: { color: "#ff0", background: "#000" } },
  ], {
    transcript: { source: "assets/video/f.mp4", words: [
      { id: "w1", text: "Hallo", t0: 0.0, t1: 0.4 }, { id: "w2", text: "äh", t0: 0.5, t1: 0.8 }, { id: "w3", text: "liebe", t0: 1.0, t1: 1.3 },
      { id: "w4", text: "Leute.", t0: 1.4, t1: 1.8 }, { id: "w5", text: "Los", t0: 3.0, t1: 3.3 },
    ], cuts: [{ t0: 0.45, t1: 0.95 }] },
  });
  const c = compile(spec);
  assert.doesNotMatch(c.html, />äh</, "cut word is not shown");
  const groups = [...c.html.matchAll(/<div id="om-cap-cap-(\d+)" class="om-cap"[^>]*>(.*?)<\/div>/g)].map((m) => m[2].replace(/<[^>]+>/g, ""));
  assert.deepEqual(groups, ["Hallo liebe", "Leute.", "Los"]);
  const w = c.anims.find((a) => a[0] === "om-cap-cap-0-1")!;
  // "liebe" starts at 1.0 s in the recording, 0.5 s were cut before it → 0.5 s in the video.
  assert.equal(w[1][2].offset, 0.05);
  assert.equal(w[1][2].color, "#ff0");
  assert.equal(w[1][2].backgroundColor, "#000");
});
