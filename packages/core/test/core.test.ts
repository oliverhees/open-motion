import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyPatch,
  compile,
  cssEasing,
  describe,
  evaluate,
  facecamLayers,
  getEase,
  layerAt,
  layerTiming,
  compositionDuration,
  sourceToComp,
  compToSource,
  keptSegments,
  findSuggestions,
  wordRange,
  isWordCut,
  sanitizeSvg,
  validateSpec,
  valueAt,
  PatchError,
  SpecError,
  type MotionSpec,
} from "@openmotion/core";

const example = JSON.parse(readFileSync(new URL("../../../examples/explainer/spec.json", import.meta.url), "utf8")) as MotionSpec;

function mini(): MotionSpec {
  return {
    version: 1,
    meta: { title: "Mini" },
    canvas: { width: 1920, height: 1080, fps: 30, background: "$bg" },
    style: { palette: { bg: "#101820", accent: "#ff6600" } },
    scenes: [
      { id: "a", name: "A", duration: 4 },
      { id: "b", name: "B", duration: 4, speed: 2 },
    ],
    layers: [
      { id: "bg", type: "shape", shape: "rect", track: 0, start: 0, duration: 8, frame: { x: 0, y: 0, w: 1920, h: 1080 }, fill: "$bg" },
      {
        id: "title",
        type: "text",
        scene: "b",
        track: 2,
        start: 1,
        duration: 2,
        frame: { x: 100, y: 100, w: 800, h: 200 },
        text: "Hallo <Welt>",
        style: { fontSize: 80, color: "$accent" },
        in: { type: "slideUp" },
      },
      {
        id: "box",
        type: "shape",
        shape: "rect",
        track: 1,
        start: 0,
        duration: 4,
        frame: { x: 0, y: 500, w: 200, h: 200 },
        keys: { x: [{ t: 0, v: 0 }, { t: 2, v: 1000, ease: "linear" }] },
      },
    ],
    transcript: { words: [{ id: "w1", text: "Bild", t0: 5.5, t1: 5.9 }] },
  };
}

test("example spec is valid", () => {
  const r = validateSpec(example);
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
});

test("validation explains problems in plain words", () => {
  const s = mini();
  (s.layers[1] as { scene?: string }).scene = "nope";
  s.layers.push({ ...s.layers[0], id: "bg" } as MotionSpec["layers"][number]);
  const r = validateSpec(s);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('scene "nope" does not exist')));
  assert.ok(r.errors.some((e) => e.includes("duplicate layer id")));
});

test("timing: scenes, relative starts, anchors, duration", () => {
  const s = mini();
  assert.deepEqual(layerTiming(s, s.layers[1]), { start: 5, end: 7, speed: 2 });
  s.layers[2].anchor = { word: "w1", offset: -0.5 };
  assert.equal(layerTiming(s, s.layers[2]).start, 5);
  assert.equal(compositionDuration(s), 9);
});

test("eases match GSAP formulas", () => {
  assert.equal(getEase("power2.in")(0.5), 0.125);
  assert.equal(getEase("power2.inOut")(0.5), 0.5);
  assert.ok(Math.abs(getEase("power3.out")(0.5) - 0.9375) < 1e-9);
  assert.ok(getEase("back.out")(0.7) > 1, "back.out overshoots");
  assert.equal(getEase("linear")(0.3), 0.3);
  assert.throws(() => getEase("bounce.wobbly"), /Unknown ease/);
  assert.match(cssEasing("power2.inOut"), /^linear\(0, /);
  assert.equal(cssEasing("linear"), "linear");
});

test("evaluate interpolates keys and paint order", () => {
  const s = mini();
  const at1 = evaluate(s, 1).find((l) => l.id === "box")!;
  assert.equal(at1.x, 500);
  assert.deepEqual(evaluate(s, 1).map((l) => l.id), ["bg", "box", "title"]);
  const title = evaluate(s, 5).find((l) => l.id === "title")!;
  assert.equal(title.visible, true);
  assert.ok(title.fx!.ty > 0 && title.fx!.opacity === 0, "slideUp starts below and invisible");
  assert.equal(layerAt(s, 1, 510, 550), "box");
  assert.equal(layerAt(s, 1, 1500, 900), "bg");
});

test("patch: set changes only the targeted layer", () => {
  const s = mini();
  const r = applyPatch(s, [{ op: "set", id: "title", path: "text", value: "Neu" }]);
  assert.equal((r.spec.layers[1] as { text: string }).text, "Neu");
  assert.deepEqual(r.changed, ["title"]);
  assert.equal((s.layers[1] as { text: string }).text, "Hallo <Welt>", "input is not mutated");
  assert.deepEqual(r.spec.layers[2], s.layers[2]);
});

test("patch: setAt auto-keys animated props and sets static ones", () => {
  const s = mini();
  let r = applyPatch(s, [{ op: "setAt", id: "box", prop: "x", t: 1, value: 300 }]);
  assert.deepEqual(r.spec.layers[2].type === "shape" && r.spec.layers[2].keys!.x!.map((k) => k.t), [0, 1, 2]);
  r = applyPatch(s, [{ op: "setAt", id: "box", prop: "y", t: 1, value: 50 }]);
  assert.equal(r.spec.layers[2].type === "shape" && r.spec.layers[2].frame.y, 50);
  r = applyPatch(s, [{ op: "setAt", id: "box", prop: "y", t: 1, value: 50, key: true }]);
  assert.deepEqual(r.spec.layers[2].type === "shape" && r.spec.layers[2].keys!.y, [{ t: 0, v: 500 }, { t: 1, v: 50 }]);
  assert.equal(valueAt(r.spec, "box", "y", 1), 50);
});

test("patch: swap keeps frame, timing, keys and transitions", () => {
  const s = mini();
  const r = applyPatch(s, [{ op: "swap", id: "box", content: { type: "image", src: "assets/image.png", source: { kind: "ai", prompt: "See" } } }]);
  const l = r.spec.layers[2];
  assert.equal(l.type, "image");
  assert.deepEqual(l.type !== "audio" && l.frame, s.layers[2].type !== "audio" && s.layers[2].frame);
  assert.deepEqual(l.keys, s.layers[2].keys);
  assert.equal("fill" in l, false, "old shape fields are gone");
});

test("patch: replace keeps id, remove/add work, errors are readable", () => {
  const s = mini();
  const r = applyPatch(s, [
    { op: "replace", id: "box", layer: { type: "svg", track: 1, start: 0, duration: 4, frame: { x: 0, y: 0, w: 100, h: 100 }, svg: "<circle r='5'/>" } as never },
    { op: "remove", id: "title" },
  ]);
  assert.equal(r.spec.layers.find((l) => l.id === "box")!.type, "svg");
  assert.equal(r.spec.layers.some((l) => l.id === "title"), false);
  assert.throws(() => applyPatch(s, [{ op: "remove", id: "nix" }]), (e: Error) => e instanceof PatchError && /Existing ids: bg, title, box/.test(e.message));
  assert.throws(() => applyPatch(s, [{ op: "set", id: "box", path: "frame.w", value: -5 }]), SpecError);
});

test("compile: layers, clips, palette, escaping, no GSAP", () => {
  const out = compile(mini());
  assert.match(out.html, /data-composition-id="main" data-no-timeline/);
  assert.match(out.html, /id="om-title"[^>]*data-om-layer="title"/);
  assert.match(out.html, /class="clip om-c om-text" data-om-id="title" data-start="5" data-duration="2"/);
  assert.match(out.html, /--om-accent:#ff6600/);
  assert.match(out.html, /color:var\(--om-accent\)/);
  assert.match(out.html, /Hallo &lt;Welt&gt;/);
  assert.match(out.html, /el\.animate\(/);
  assert.doesNotMatch(out.html, /gsap/i);
  assert.equal(out.duration, 8);
  const half = compile(mini(), { scale: 0.5 });
  assert.equal(half.width, 960);
  assert.match(half.html, /font-size:40px/);
});

test("compile: example renders every layer, audio stays top-level", () => {
  const out = compile(example);
  for (const l of example.layers) assert.match(out.html, new RegExp(`data-om-id="${l.id}"`));
  assert.match(out.html, /<audio id="om-c-music" class="clip"/);
  assert.deepEqual(out.assets.sort(), ["assets/facecam.mp4", "assets/fonts/bricolage-grotesque-latin.woff2", "assets/image.png", "assets/music.mp3"]);
});

test("sanitizeSvg strips scripts and handlers", () => {
  const dirty = `<g onclick="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)"><circle r="4"/></a><foreignObject><div/></foreignObject></g>`;
  const clean = sanitizeSvg(dirty);
  assert.doesNotMatch(clean, /alert|script|foreignObject|onclick/);
  assert.match(clean, /<circle r="4"\/>/);
});

test("facecam preset: muted video + detached audio", () => {
  const [video, audio] = facecamLayers({ src: "cam.mp4", duration: 10, canvas: { width: 1920, height: 1080, fps: 30 }, layout: "corner" });
  assert.equal(video.muted, true);
  assert.equal(audio.src, "cam.mp4");
  assert.ok(video.frame.x + video.frame.w < 1920 && video.frame.y + video.frame.h < 1080);
});

test("describe gives AI a compact map", () => {
  const text = describe(example);
  assert.match(text, /\[50\] cam \(video\)/);
  assert.match(text, /anchored to word w22/);
});

test("compile: quoted font names stay inside the style attribute", () => {
  const s = mini();
  (s.layers[1] as { style: { fontFamily?: string } }).style.fontFamily = 'Bricolage "Grotesque"';
  const html = compile(s).html;
  const tag = /<div id="om-c-title"[^>]*>/.exec(html)![0];
  assert.match(tag, /style="font-family:&quot;Bricolage \\&quot;Grotesque\\&quot;&quot;,system-ui,sans-serif;font-size:80px;[^"]*color:var\(--om-accent\)/);
});

test("patch: meta changes the project title", () => {
  const r = applyPatch(mini(), [{ op: "meta", set: { title: "Neu" } }]);
  assert.equal(r.spec.meta.title, "Neu");
});

test("anchors follow the recording: move the facecam, anchored layers move along", () => {
  const s = structuredClone(example);
  const before = layerTiming(s, s.layers.find((l) => l.id === "s3-bild")!).start;
  assert.ok(Math.abs(before - 10.12) < 1e-9);
  const moved = applyPatch(s, [{ op: "set", id: "cam", path: "start", value: 2 }, { op: "set", id: "cam-audio", path: "start", value: 2 }]).spec;
  assert.ok(Math.abs(layerTiming(moved, moved.layers.find((l) => l.id === "s3-bild")!).start - 12.12) < 1e-9);
  const trimmed = applyPatch(s, [{ op: "set", id: "cam", path: "mediaStart", value: 1 }]).spec;
  assert.ok(Math.abs(layerTiming(trimmed, trimmed.layers.find((l) => l.id === "s3-bild")!).start - 9.12) < 1e-9);
  assert.equal(sourceToComp(moved, 10.42), 12.42);
  assert.equal(compToSource(moved, 12.42), 10.42);
});

test("new transcript keeps anchors on the nearest word; word typo fix", () => {
  const s = structuredClone(example);
  const words = s.transcript!.words.map((w, i) => ({ ...w, id: `n${i}` }));
  const r = applyPatch(s, [{ op: "transcript", set: { source: s.transcript!.source, words } }]);
  assert.equal(r.spec.layers.find((l) => l.id === "s3-bild")!.anchor!.word, "n21");
  const fixed = applyPatch(r.spec, [{ op: "word", id: "n21", text: "Foto" }]);
  assert.equal(fixed.spec.transcript!.words[21].text, "Foto");
  const gone = applyPatch(s, [{ op: "transcript", set: null }]);
  assert.equal(gone.spec.layers.some((l) => l.anchor), false);
});

test("cuts: facecam gets shorter, anchors and transcript map through the cut", () => {
  const s = structuredClone(example);
  const cut = applyPatch(s, [{ op: "cut", t0: 2, t1: 3 }, { op: "cut", t0: 2.8, t1: 3.5 }, { op: "cut", t0: 6, t1: 6.5, reason: "pause" }]).spec;
  assert.deepEqual(cut.transcript!.cuts, [{ t0: 2, t1: 3.5, reason: "manual" }, { t0: 6, t1: 6.5, reason: "pause" }]);
  const cam = cut.layers.find((l) => l.id === "cam")!;
  assert.equal(layerTiming(cut, cam).end, 11);
  assert.equal(layerTiming(cut, cut.layers.find((l) => l.id === "cam-audio")!).end, 11);
  assert.ok(Math.abs(layerTiming(cut, cut.layers.find((l) => l.id === "s3-bild")!).start - 8.12) < 1e-9, "anchor moved 2 s earlier");
  assert.equal(sourceToComp(cut, 2.5), 2, "inside a cut → cut point");
  assert.equal(compToSource(cut, 2.1), 3.6);
  assert.deepEqual(keptSegments(cut, cam as never), [{ src0: 0, src1: 2, rel0: 0 }, { src0: 3.5, src1: 6, rel0: 2 }, { src0: 6.5, src1: 13, rel0: 4.5 }]);
  const html = compile(cut).html;
  assert.equal((html.match(/<video id="om-c-cam/g) ?? []).length, 3);
  assert.match(html, /<video id="om-c-cam-s1" class="clip om-c" data-om-id="cam" data-start="2" data-duration="2.5" data-track-index="\d+" data-media-start="3.5"/);
  assert.equal((html.match(/<audio id="om-c-cam-audio/g) ?? []).length, 3);
  assert.match(compile(cut, { audioOverrides: { "cam-audio": "assets/_cut/cam-audio.m4a" } }).html, /<audio id="om-c-cam-audio" class="clip" src="assets\/_cut\/cam-audio.m4a" data-om-id="cam-audio" data-start="0" data-duration="11"/);
  const restored = applyPatch(cut, [{ op: "uncut", t0: 2.5, t1: 3 }]).spec;
  assert.deepEqual(restored.transcript!.cuts!.map((c) => [c.t0, c.t1]), [[2, 2.5], [3, 3.5], [6, 6.5]]);
  assert.equal(applyPatch(cut, [{ op: "cuts", set: [] }]).spec.transcript!.cuts, undefined);
});

test("suggestions: filler words and long pauses", () => {
  const t = { words: [
    { id: "a", text: "Also", t0: 0, t1: 0.4 }, { id: "b", text: "ähm", t0: 0.5, t1: 0.8 }, { id: "c", text: "das", t0: 0.9, t1: 1.1 },
    { id: "d", text: "geht.", t0: 2.6, t1: 3 }, { id: "e", text: "Äh,", t0: 3.1, t1: 3.3 }, { id: "f", text: "gut", t0: 3.4, t1: 3.6 },
  ] };
  const s = findSuggestions(t);
  assert.deepEqual(s.map((x) => `${x.kind}:${x.label}`), ["filler:ähm", "pause:1.5 s", "filler:Äh,"]);
  assert.deepEqual([s[1].t0, s[1].t1], [1.25, 2.45]);
  assert.equal(findSuggestions({ ...t, cuts: [{ t0: 0.5, t1: 0.9 }] }).filter((x) => x.kind === "filler").length, 1);
  assert.deepEqual(wordRange(t, "b"), { t0: 0.5, t1: 0.9 });
  assert.equal(isWordCut({ ...t, cuts: [{ t0: 0.5, t1: 0.9 }] }, "b"), true);
  assert.equal(isWordCut({ ...t, cuts: [{ t0: 0.5, t1: 0.9 }] }, "c"), false);
});
