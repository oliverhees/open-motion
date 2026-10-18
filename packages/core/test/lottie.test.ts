import { test } from "node:test";
import assert from "node:assert/strict";
import { backgroundLayers, compile, parseColor, toLottie, type MotionSpec } from "@openmotion/core";

const base = (layers: MotionSpec["layers"], extra: Partial<MotionSpec> = {}): MotionSpec => ({
  version: 1, meta: { title: "t", lang: "de" }, canvas: { width: 1920, height: 1080, fps: 30, background: "$bg" },
  style: { palette: { bg: "#101010", ink: "#ffffff", accent: "#ff3300" } }, scenes: [{ id: "s", name: "s", duration: 2 }], layers, ...extra,
});
const bg = { id: "bg", type: "shape", shape: "rect", track: 0, start: 0, duration: 2, frame: { x: 0, y: 0, w: 1920, h: 1080 }, fill: "$bg" } as const;

test("transparent overlays: full-canvas shapes are the background, images are offered but kept; compile drops color, texture and hidden layers", () => {
  const spec = base([
    bg,
    { id: "photo", type: "image", track: 1, start: 0, duration: 2, frame: { x: -10, y: -10, w: 1940, h: 1100 }, src: "assets/a.png" },
    { id: "box", type: "shape", shape: "rect", track: 2, start: 0, duration: 2, frame: { x: 100, y: 100, w: 300, h: 200 }, fill: "$accent" },
  ], { canvas: { width: 1920, height: 1080, fps: 30, background: "$bg", texture: { grain: 0.5 } } });
  assert.deepEqual(backgroundLayers(spec).map((b) => [b.id, b.hideByDefault]), [["bg", true], ["photo", false]]);
  const c = compile(spec, { transparent: true, hide: ["bg"] });
  assert.match(c.html, /#root\{[^}]*background:transparent/);
  assert.match(c.html, /html,body\{[^}]*background:transparent/);
  assert.ok(!c.html.includes('id="om-bg"'), "hidden layer left out");
  assert.ok(c.html.includes('id="om-box"'));
  assert.ok(!c.html.includes("om-grain"), "no texture on a transparent export");
  assert.ok(compile(spec).html.includes("om-grain"), "normal export keeps the texture");
});

test("lottie: structure, frame-exact transitions, thinned keyframes, masks for wipes, warnings instead of silent gaps", () => {
  const spec = base([
    bg,
    { id: "card", type: "shape", shape: "rect", track: 1, start: 0, duration: 2, frame: { x: 100, y: 200, w: 400, h: 200 }, fill: "linear-gradient(90deg, $accent, #0000ff80)", radius: 20, in: { type: "slideUp", duration: 0.5 } },
    { id: "wipe", type: "shape", shape: "ellipse", track: 2, start: 0.5, duration: 1.5, frame: { x: 800, y: 200, w: 200, h: 200 }, fill: "#00ff00", in: { type: "wipe", duration: 0.5 } },
    { id: "title", type: "text", track: 3, start: 0, duration: 2, frame: { x: 100, y: 600, w: 1200, h: 200 }, text: "Hallo [[Welt]]", style: { fontSize: 80, fontFamily: "Anton", color: "$ink" }, anim: { type: "rise", by: "word" } },
    { id: "n", type: "text", track: 3, start: 0, duration: 2, frame: { x: 1400, y: 600, w: 400, h: 200 }, text: "0", style: { fontSize: 80 }, count: { from: 0, to: 50, suffix: " %" } },
    { id: "vid", type: "video", track: 4, start: 0, duration: 2, frame: { x: 0, y: 0, w: 100, h: 100 }, src: "assets/v.mp4" },
  ]);
  const { json, warnings } = toLottie(spec, { hide: ["bg"] });
  assert.equal(json.fr, 30);
  assert.equal(json.op, 60);
  assert.equal(json.w, 1920);
  const layers = json.layers as Record<string, any>[];
  assert.ok(!layers.some((l) => String(l.nm).startsWith("bg")), "hidden background left out");
  // Top of the list = top of the stack: the counter (track 3, last) comes first, the card frame last.
  assert.match(String(layers[0].nm), /^n/);
  const card = layers.find((l) => l.nm === "card")!;
  const frame = layers.find((l) => l.ind === card.parent)!;
  assert.equal(frame.ty, 3, "frame transform on a null parent");
  assert.deepEqual(frame.ks.p.k, [300, 300, 0]);
  // slideUp: content moves from y+60 to 0 over 15 frames with power3.out.
  const p = card.ks.p;
  assert.equal(p.a, 1);
  assert.deepEqual(p.k[0].s, [0, 60, 0]);
  assert.deepEqual(p.k.at(-1).s, [0, 0, 0]);
  assert.ok(p.k.length <= 16, `curve kept, the 45 still frames after it collapse (${p.k.length} keys for 60 frames)`);
  const grad = card.shapes[0].it.find((i: any) => i.ty === "gf");
  assert.equal(grad.t, 1);
  assert.deepEqual(grad.g.k.k, [0, 1, 0.2, 0, 1, 0, 0, 1, 0, 1, 1, 0.502], "colors then alpha stops");
  const wipe = layers.find((l) => l.nm === "wipe")!;
  assert.equal(wipe.hasMask, true);
  assert.equal(wipe.ip, 15);
  const title = layers.find((l) => l.nm === "title")!;
  assert.equal(title.ty, 5);
  assert.equal(title.t.d.k[0].s.t, "Hallo Welt");
  assert.equal(title.t.a[0].s.s.k, 6, "highlight starts at 'Welt'");
  assert.equal(title.t.a[0].s.e.k, 10);
  assert.deepEqual(title.t.a[0].a.fc.k, [1, 0.2, 0, 1], "highlight in the accent color");
  const n = layers.find((l) => l.nm === "n")!;
  const texts = n.t.d.k.map((k: any) => k.s.t);
  assert.equal(texts[0], "0 %");
  assert.equal(texts.at(-1), "50 %");
  assert.ok(texts.length > 10, "counter keyframes");
  assert.ok((json.fonts as any).list.some((f: any) => f.fFamily === "Anton"));
  const codes = warnings.map((w) => w.code).sort();
  assert.deepEqual(codes, ["fonts", "textAnim", "video"]);
  assert.deepEqual(warnings.find((w) => w.code === "video")!.layers, ["vid"]);
});

test("lottie: colors parse like CSS (hex, short hex, alpha, rgb/rgba, palette, names)", () => {
  assert.deepEqual(parseColor("#f00"), [1, 0, 0, 1]);
  assert.deepEqual(parseColor("#00ff0080"), [0, 1, 0, 0.502]);
  assert.deepEqual(parseColor("rgba(255, 0, 0, .5)"), [1, 0, 0, 0.5]);
  assert.deepEqual(parseColor("rgb(0 0 255 / 25%)"), [0, 0, 1, 0.25]);
  assert.deepEqual(parseColor("$ink", { ink: "#ffffff" }), [1, 1, 1, 1]);
  assert.deepEqual(parseColor("white"), [1, 1, 1, 1]);
  assert.equal(parseColor("var(--x)"), null);
});

test("svg ids are scoped per layer: a pattern id equal to a layer box id still works, two layers keep their own gradients", () => {
  const svg = (id: string) => ({ id, type: "svg", track: 1, start: 0, duration: 2, frame: { x: 0, y: 0, w: 100, h: 100 }, svg: `<defs><pattern id="om-dots"/><linearGradient id="g"/></defs><rect fill="url(#om-dots)" style="fill:url('#g')"/><use href="#g"/>` }) as const;
  const html = compile(base([svg("dots"), svg("other")])).html;
  assert.ok(html.includes('id="om-svg-dots-om-dots"') && html.includes("url(#om-svg-dots-om-dots)"));
  assert.ok(html.includes("url(#om-svg-other-g)") && html.includes('href="#om-svg-other-g"'));
  assert.equal((html.match(/id="om-dots"/g) ?? []).length, 1, "only the layer box keeps om-dots");
});
