// Plays a Motion-Spec's Lottie export in lottie-web (real player, Chrome) and saves frames next to the
// browser preview of the same moments: <outDir>/lottie-<t>.png and <outDir>/html-<t>.png.
//   node scripts/lottie-frames.ts <spec.json> <outDir> [t1 t2 …]
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { backgroundLayers, compile, compositionDuration, toLottie, type MotionSpec } from "@openmotion/core";
import { findChrome } from "../packages/server/src/frames.ts";
import { fontMetrics } from "../packages/render/src/fontmetrics.ts";
import puppeteer from "puppeteer-core";

const [specFile, outDir, ...times] = process.argv.slice(2);
if (!specFile || !outDir) { console.error("usage: node scripts/lottie-frames.ts <spec.json> <outDir> [seconds …]"); process.exit(1); }
const dir = path.dirname(path.resolve(specFile));
const spec = JSON.parse(readFileSync(specFile, "utf8")) as MotionSpec;
const hide = backgroundLayers(spec).filter((b) => b.hideByDefault).map((b) => b.id);
const images: Record<string, string> = {};
for (const l of spec.layers) if (l.type === "image" && existsSync(path.join(dir, l.src))) images[l.src] = `data:image/${path.extname(l.src).slice(1).replace("jpg", "jpeg")};base64,${readFileSync(path.join(dir, l.src)).toString("base64")}`;
const metrics: Record<string, { ascent: number; descent: number }> = {};
for (const f of spec.style?.fonts ?? []) { const m = existsSync(path.join(dir, f.src)) ? fontMetrics(readFileSync(path.join(dir, f.src))) : null; if (m) metrics[f.family.toLowerCase()] = m; }
console.log("metrics:", JSON.stringify(metrics));
const { json, warnings } = toLottie(spec, { hide, images, fontMetrics: metrics });
console.log("warnings:", JSON.stringify(warnings));
mkdirSync(outDir, { recursive: true });
const lottieJs = createRequire(import.meta.url).resolve("lottie-web/build/player/lottie.min.js");
const faces = (spec.style?.fonts ?? []).map((f) => `@font-face{font-family:"${f.family}";src:url("file://${path.join(dir, f.src)}");font-weight:${f.weight ?? "100 900"}}`).join("\n");
const W = spec.canvas.width, H = spec.canvas.height;
const lottieHtml = path.join(dir, ".lottie.html");
writeFileSync(lottieHtml, `<!doctype html><html><head><style>${faces}html,body{margin:0;background:#888}#a{width:${W}px;height:${H}px}</style>
<script src="file://${lottieJs}"></script></head><body><div id="a"></div><script>
window.anim = lottie.loadAnimation({ container: document.getElementById("a"), renderer: "svg", loop: false, autoplay: false, animationData: ${JSON.stringify(json)} });
</script></body></html>`);
const c = compile(spec, { transparent: true, hide });
const htmlFile = path.join(dir, ".overlay.html");
writeFileSync(htmlFile, c.html.replace("html,body{margin:0;padding:0;background:transparent}", "html,body{margin:0;padding:0;background:#888}"));
const d = compositionDuration(spec);
const ts = times.length ? times.map(Number) : Array.from({ length: 6 }, (_, i) => Math.round(((i + 0.5) / 6) * d * 100) / 100);
const browser = await puppeteer.launch({ executablePath: findChrome(), args: ["--no-sandbox", "--allow-file-access-from-files"], defaultViewport: { width: W, height: H } });
const page = await browser.newPage();
page.on("pageerror", (e) => console.error("page error:", String(e)));
await page.goto(`file://${lottieHtml}`, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
await new Promise((r) => setTimeout(r, 400));
for (const t of ts) {
  await page.evaluate((f) => (window as any).anim.goToAndStop(f, true), Math.round(t * (json.fr as number)));
  await new Promise((r) => setTimeout(r, 60));
  await page.screenshot({ path: path.join(outDir, `lottie-${t.toFixed(2)}.png`) as `${string}.png` });
}
await page.goto(`file://${htmlFile}`, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
for (const t of ts) {
  await page.evaluate((x) => (window as any).__om.seek(x), t);
  await new Promise((r) => setTimeout(r, 80));
  await page.screenshot({ path: path.join(outDir, `html-${t.toFixed(2)}.png`) as `${string}.png` });
}
await browser.close();
console.log(ts.join(" "));
