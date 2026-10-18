// Renders still frames of a Motion-Spec (fast visual check, no video encode).
//   node scripts/frames.ts <spec.json> <outDir> [t1 t2 …]      default: 8 frames spread over the video
// Assets are resolved next to the spec file.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { compile, compositionDuration, type MotionSpec } from "@openmotion/core";
import { findChrome } from "../packages/server/src/frames.ts";
import puppeteer from "puppeteer-core";

const [specFile, outDir, ...times] = process.argv.slice(2);
if (!specFile || !outDir) {
  console.error("usage: node scripts/frames.ts <spec.json> <outDir> [seconds …]");
  process.exit(1);
}
const spec = JSON.parse(readFileSync(specFile, "utf8")) as MotionSpec;
const c = compile(spec);
mkdirSync(outDir, { recursive: true });
const html = path.join(path.dirname(path.resolve(specFile)), ".frames.html");
writeFileSync(html, c.html);
const d = compositionDuration(spec);
const ts = times.length ? times.map(Number) : Array.from({ length: 8 }, (_, i) => Math.round(((i + 0.5) / 8) * d * 100) / 100);
const browser = await puppeteer.launch({ executablePath: findChrome(), args: ["--no-sandbox", "--allow-file-access-from-files"], defaultViewport: { width: c.width, height: c.height } });
const page = await browser.newPage();
page.on("pageerror", (e) => console.error("page error:", String(e)));
await page.goto(`file://${html}`, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
for (const t of ts) {
  await page.evaluate((x) => (window as unknown as { __om: { seek(t: number): void } }).__om.seek(x), t);
  await new Promise((r) => setTimeout(r, 80));
  const file = path.join(outDir, `t${t.toFixed(2)}.png`);
  await page.screenshot({ path: file });
  console.log(file);
}
await browser.close();
if (c.warnings.length) console.log("warnings:", c.warnings.join("; "));
