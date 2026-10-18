// Checks that the starter title and subtitle of every style × format × language fit their frames (real fonts, real Chrome).
//   node scripts/starter-fit.ts <outDir>
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { compile, STYLES, FORMATS } from "@openmotion/core";
import { blankSpec } from "../packages/server/src/store.ts";
import { ensureFonts } from "../packages/server/src/fonts.ts";
import { findChrome } from "../packages/server/src/frames.ts";
import puppeteer from "puppeteer-core";
const out = process.argv[2];
const browser = await puppeteer.launch({ executablePath: findChrome(), args: ["--no-sandbox", "--allow-file-access-from-files"] });
const page = await browser.newPage();
const bad: string[] = [];
for (const st of STYLES) for (const f of FORMATS) for (const lang of ["de", "en"] as const) {
  const dir = path.join(out, `${st.id}-${f.replace(":", "x")}-${lang}`);
  mkdirSync(dir, { recursive: true });
  let spec = blankSpec(lang, { format: f, style: st.id });
  const r = await ensureFonts(spec, dir);
  if (r?.op) { const { applyPatch } = await import("@openmotion/core"); spec = applyPatch(spec, [r.op]).spec; }
  const c = compile(spec);
  writeFileSync(path.join(dir, "i.html"), c.html);
  await page.setViewport({ width: c.width, height: c.height });
  await page.goto(`file://${dir}/i.html`, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => (window as any).__om.seek(3));
  const res = await page.evaluate(() => ["title", "sub"].map((id) => {
    const el = document.getElementById(`om-${id}`) as HTMLElement; if (!el) return `${id}:missing`;
    const box = el.getBoundingClientRect();
    let maxB = 0, maxR = 0;
    el.querySelectorAll("*").forEach((n) => { const b = (n as HTMLElement).getBoundingClientRect(); if (b.width) { maxB = Math.max(maxB, b.bottom); maxR = Math.max(maxR, b.right); } });
    return maxB > box.bottom + 2 || maxR > box.right + 2 ? `${id}: content ${Math.round(maxR)}x${Math.round(maxB)} > box ${Math.round(box.right)}x${Math.round(box.bottom)}` : "";
  }).filter(Boolean));
  if (res.length) bad.push(`${st.id} ${f} ${lang}: ${res.join("; ")}`);
  if (lang === "de" && ["vhs","brutal","kinetic","swiss"].includes(st.id)) await page.screenshot({ path: path.join(out, `${st.id}-${f.replace(":", "x")}.png`) as `${string}.png` });
}
await browser.close();
console.log(bad.length ? bad.join("\n") : "ALL FIT");
