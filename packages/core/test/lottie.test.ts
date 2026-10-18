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

test("templates: the template op builds a scene or an overlay in the project's look, ids stay unique, unknown ids explain themselves", async () => {
  const { applyPatch, TEMPLATES, templateDefaults } = await import("@openmotion/core");
  const spec = base([bg], { meta: { title: "T", lang: "de", style: "kinetic" } });
  assert.ok(TEMPLATES.length >= 25, `${TEMPLATES.length} templates`);
  // Scene template: a new scene after the current one, fonts of the style.
  const a = applyPatch(spec, [{ op: "template", id: "title", at: 0.5, values: { title: "Hallo [[Welt]]" } }]).spec;
  assert.equal(a.scenes.length, 2);
  assert.equal(a.scenes[1].id, "title1");
  const title = a.layers.find((l) => l.id === "title1-title");
  assert.ok(title?.type === "text" && title.style.fontFamily === "Anton" && title.text.includes("[[Welt]]"));
  assert.equal(title.scene, "title1");
  // Twice: unique ids.
  const b = applyPatch(a, [{ op: "template", id: "title", at: 0.5 }]).spec;
  assert.ok(b.layers.some((l) => l.id === "title2-title"));
  // Overlay at the playhead inside the current scene.
  const c = applyPatch(spec, [{ op: "template", id: "lowerthird", at: 1, values: { name: "Oliver", role: "Gründer" } }]).spec;
  const name = c.layers.find((l) => l.id === "lowerthird1-name");
  assert.ok(name && name.scene === "s" && name.start >= 1);
  // A recording running through: scene templates become a full-screen card over it, no new scene.
  const rec = base([bg, { id: "cam", type: "video", track: 50, start: 0, duration: 20, frame: { x: 0, y: 0, w: 1920, h: 1080 }, src: "assets/v.mp4" }], { scenes: [{ id: "s", name: "s", duration: 20 }] });
  const d = applyPatch(rec, [{ op: "template", id: "quote", at: 5 }]).spec;
  assert.equal(d.scenes.length, 1);
  assert.ok(d.layers.some((l) => l.id === "quote1-bg" && l.track > 50), "own background above the recording");
  // Brand-aware defaults.
  const branded = { ...spec, meta: { ...spec.meta, brand: { id: "b", name: "AIIANER", handle: "@aiianer", website: "aiianer.de" } } };
  assert.equal(templateDefaults(branded, "outro").handle, "@aiianer");
  assert.throws(() => applyPatch(spec, [{ op: "template", id: "nope" }]), /Unknown template "nope". Available: intro, title/);
});

test("fitText: shrinks before it overflows, hyphenates words too long for a line, keeps [[highlights]] intact per line", async () => {
  const { fitText } = await import("@openmotion/core");
  const a = fitText("Kurz", 1000, 200, 120, 40, 0.6, 1.04);
  assert.equal(a.size, 120);
  const b = fitText("Ein deutlich längerer Text, der umbrechen muss", 600, 400, 120, 40, 0.6, 1.04);
  assert.ok(b.size < 120 && b.lines > 1 && b.lines * b.size * 1.04 <= 400);
  const c = fitText("Datenschutzgrundverordnung", 300, 400, 100, 60, 0.6, 1.04);
  assert.match(c.text, /-\n/, "hyphenated");
  const d = fitText("Das ist [[wirklich sehr wichtig]] heute", 420, 600, 80, 20, 0.6, 1.04);
  for (const line of d.text.split("\n")) assert.equal((line.match(/\[\[/g) ?? []).length, (line.match(/\]\]/g) ?? []).length, `balanced: ${line}`);
});

test("templates work on any project: every template on the example (own palette without $surface/$muted, a recording) stays a valid spec", async () => {
  const { readFileSync } = await import("node:fs");
  const { applyPatch, TEMPLATES } = await import("@openmotion/core");
  const example = JSON.parse(readFileSync(new URL("../../../examples/explainer/spec.json", import.meta.url), "utf8"));
  for (const t of TEMPLATES) {
    const r = applyPatch(example, [{ op: "template", id: t.id, at: 3 }]);
    assert.ok(r.spec.layers.length > example.layers.length, t.id);
    assert.ok(!JSON.stringify(r.spec.layers).includes("$surface"), `${t.id}: missing tokens replaced`);
  }
});

test("templates: an overlay near the end of a scene is shortened to fit (≥ 2 s left), very close to the end the scene grows", async () => {
  const { applyPatch } = await import("@openmotion/core");
  const spec = base([bg], { scenes: [{ id: "s", name: "s", duration: 5 }] });
  const a = applyPatch(spec, [{ op: "template", id: "lowerthird", at: 2.5 }]).spec;
  assert.equal(a.scenes[0].duration, 5, "scene unchanged");
  for (const l of a.layers.filter((x) => x.id.startsWith("lowerthird1-"))) assert.ok(l.start + l.duration <= 5 + 1e-6, `${l.id} ends in the scene`);
  const b = applyPatch(spec, [{ op: "template", id: "lowerthird", at: 4.2 }]).spec;
  assert.ok(b.scenes[0].duration > 8, "scene extended when less than 2 s are left");
});

test("templates: every template in every style and format (and both languages) gives a valid spec", async () => {
  const { applyPatch, FORMATS, FORMAT_SIZE, STYLES, TEMPLATES } = await import("@openmotion/core");
  let n = 0;
  for (const f of FORMATS) for (const st of STYLES) for (const lang of ["de", "en"]) {
    const { width, height } = FORMAT_SIZE[f];
    const spec = base([], { meta: { title: "T", lang, style: st.id }, canvas: { width, height, fps: 30, background: "$bg" }, style: { palette: { ...st.palette } } });
    for (const t of TEMPLATES) { applyPatch(spec, [{ op: "template", id: t.id, at: 1 }]); n++; }
  }
  assert.equal(n, 4 * STYLES.length * 2 * TEMPLATES.length);
});

test("scene op: a shorter scene trims its layers and their late keyframes, anchored layers stay", async () => {
  const { applyPatch } = await import("@openmotion/core");
  const spec = base([
    { id: "a", type: "shape", shape: "rect", track: 1, scene: "s", start: 0.5, duration: 1.5, frame: { x: 0, y: 0, w: 10, h: 10 }, fill: "#fff", keys: { scale: [{ t: 0, v: 1 }, { t: 1.4, v: 2 }] } },
    { id: "b", type: "shape", shape: "rect", track: 1, scene: "s", start: 0, duration: 0.5, frame: { x: 0, y: 0, w: 10, h: 10 }, fill: "#fff" },
  ]);
  const out = applyPatch(spec, [{ op: "scene", id: "s", set: { duration: 1.2 } }]).spec;
  const a = out.layers.find((l) => l.id === "a")!;
  assert.equal(a.duration, 0.7);
  assert.deepEqual(a.type === "shape" && a.keys?.scale?.map((k) => k.t), [0]);
  assert.equal(out.layers.find((l) => l.id === "b")!.duration, 0.5, "layers that fit stay");
});

test("lottie: a glow fading to transparent keeps its color (no dark ring)", () => {
  const spec = base([{ id: "g", type: "shape", shape: "ellipse", track: 1, start: 0, duration: 2, frame: { x: 0, y: 0, w: 400, h: 400 }, fill: "radial-gradient(circle, $accent 0%, transparent 65%)" }]);
  const layer = (toLottie(spec).json.layers as Record<string, any>[]).find((l) => l.nm === "g")!;
  const gf = layer.shapes[0].it.find((i: any) => i.ty === "gf");
  assert.deepEqual(gf.g.k.k, [0, 1, 0.2, 0, 0.65, 1, 0.2, 0, 0, 1, 0.65, 0]);
});
