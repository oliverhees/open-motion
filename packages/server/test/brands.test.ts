import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyPatch, brandPalette, compositionDuration } from "@openmotion/core";
import { Store } from "../src/store.ts";
import { applyBrand, BrandStore, imageSize } from "../src/brands.ts";

process.env.OPENMOTION_NO_FONT_DOWNLOAD = "1";

/** Smallest PNG header the size reader needs: 400×100. */
function png(w: number, h: number): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}

test("brand palette: missing colors are derived so text stays readable", () => {
  const light = brandPalette({ accent: "#0055ff", bg: "#ffffff" });
  assert.equal(light.ink, "#111111", "dark text on a light background");
  assert.equal(light.accent, "#0055FF");
  assert.match(light.surface, /^#[0-9A-F]{6}$/);
  const dark = brandPalette({ accent: "#f60" }, { bg: "#000000", glow: "#123456" });
  assert.equal(dark.ink, "#F7F7F8");
  assert.equal(dark.accent, "#FF6600");
  assert.equal(dark.glow, "#123456", "style-only palette keys stay");
});

test("brand kit: create, logo, apply to a project (palette, fonts, logo bug), stays as long as the video, switch off restores everything", async () => {
  const data = await mkdtemp(path.join(os.tmpdir(), "om-brand-"));
  const brands = new BrandStore(data);
  const store = new Store(data, path.resolve(import.meta.dirname, "../../../examples/explainer"));
  let b = await brands.create({ name: "AIIANER", colors: { accent: "#e11d48", bg: "#0a0a0a" }, fonts: { display: { family: "Anton", weight: 400 }, body: { family: "Inter", weight: 420 } }, tagline: "KI für alle", handle: "@aiianer", watermark: { corner: "br" } });
  assert.match(b.id, /^aiianer-[0-9a-f]{4}$/);
  assert.equal(b.fonts.body?.weight, 400, "weights snap to 100s");
  await assert.rejects(brands.update(b.id, { colors: { accent: "red" } }), /hex color like #FF5A1F/);
  b = await brands.setLogo(b.id, png(400, 100), "image/png");
  assert.equal(b.logoAspect, 4);
  await assert.rejects(brands.setLogo(b.id, Buffer.from("hello"), "image/gif"), /PNG, JPEG, WebP or SVG/);

  const p = await store.create("Test", "blank", "de", { format: "16:9", style: "keynote" });
  const before = (await store.read(p.id)).spec;
  const { spec } = await applyBrand(store, brands, p.id, b.id);
  assert.equal(spec.style?.palette?.accent, "#E11D48");
  assert.equal(spec.style?.palette?.bg, "#0A0A0A");
  assert.equal(spec.meta.brand?.name, "AIIANER");
  assert.equal(spec.meta.brand?.handle, "@aiianer");
  assert.ok(spec.meta.brand?.logo && existsSync(path.join(store.dir(p.id), spec.meta.brand.logo)), "logo copied into the project");
  const title = spec.layers.find((l) => l.id === "title");
  const sub = spec.layers.find((l) => l.id === "sub");
  assert.equal(title?.type === "text" && title.style.fontFamily, "Anton", "headline font → brand display");
  assert.equal(sub?.type === "text" && sub.style.fontFamily, "Inter", "body font → brand body");
  const wm = spec.layers.find((l) => l.id === "brand-logo");
  assert.ok(wm && wm.type === "image" && wm.fixed);
  assert.ok(wm.type === "image" && wm.frame.x > 1500 && wm.frame.y > 900, "bottom right");
  assert.equal(wm.type === "image" && wm.frame.w, wm.type === "image" ? wm.frame.h * 4 : 0, "keeps the logo's aspect");

  // The video gets longer → the logo bug follows on save.
  const longer = applyPatch(spec, [{ op: "scene", id: "s1", set: { duration: 12 } }]).spec;
  await store.saveSpec(p.id, longer);
  const saved = (await store.read(p.id)).spec;
  assert.equal(saved.layers.find((l) => l.id === "brand-logo")?.duration, compositionDuration({ ...saved, layers: saved.layers.filter((l) => l.id !== "brand-logo") }));

  const off = (await applyBrand(store, brands, p.id, null)).spec;
  assert.equal(off.meta.brand, undefined);
  assert.deepEqual(off.style?.palette, before.style?.palette);
  assert.ok(!off.layers.some((l) => l.id === "brand-logo"));
  const t2 = off.layers.find((l) => l.id === "title");
  assert.equal(t2?.type === "text" && t2.style.fontFamily, before.layers.find((l) => l.id === "title")?.type === "text" ? (before.layers.find((l) => l.id === "title") as { style: { fontFamily?: string } }).style.fontFamily : "", "fonts back");

  const tw = (x: typeof off) => { const l = x.layers.find((q) => q.id === "title"); return l?.type === "text" ? l.style.fontWeight : -1; };
  assert.equal(tw(off), tw(before), "weights back too");
  // A much wider brand font: the starter headline shrinks so it cannot wrap, and comes back on removal.
  const wide = await brands.create({ name: "Wide", colors: { accent: "#00ff88" }, fonts: { display: { family: "Rubik Mono One" } } });
  const p2 = await store.create("Wide", "blank", "en", { format: "9:16", style: "kinetic" });
  const size = (x: { layers: { id: string; type: string }[] }) => { const l = x.layers.find((q) => q.id === "title") as { style: { fontSize: number } }; return l.style.fontSize; };
  const s0 = size((await store.read(p2.id)).spec);
  const s1 = size((await applyBrand(store, brands, p2.id, wide.id)).spec);
  assert.ok(s1 < s0 * 0.6, `Anton (0.44 em) → Rubik Mono One (0.75+ em): ${s0} → ${s1}`);
  assert.equal(size((await applyBrand(store, brands, p2.id, null)).spec), s0);
  await brands.remove(wide.id);
  await brands.remove(b.id);
  assert.deepEqual(await brands.list(), []);
});

test("image size from file headers (PNG, SVG viewBox, garbage)", () => {
  assert.deepEqual(imageSize(png(640, 480)), { w: 640, h: 480 });
  assert.deepEqual(imageSize(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><rect/></svg>')), { w: 120, h: 40 });
  assert.equal(imageSize(Buffer.from("nope")), null);
});
