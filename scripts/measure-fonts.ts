// Measures how wide each style's fonts really are (em per character) with realistic text, in Chrome.
// The numbers go into styles.ts (displayWidth, displayUpper, bodyWidth) and size headlines so they never wrap.
//   node scripts/measure-fonts.ts <workDir>
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { STYLES, type MotionSpec } from "@openmotion/core";
import { ensureFonts } from "../packages/server/src/fonts.ts";
import { findChrome } from "../packages/server/src/frames.ts";
import puppeteer from "puppeteer-core";

const dir = process.argv[2];
if (!dir) { console.error("usage: node scripts/measure-fonts.ts <workDir>"); process.exit(1); }
mkdirSync(dir, { recursive: true });
// Wide letters (M, W, m, w) included on purpose: averages from narrow words under-size a headline.
const corpus = ["Max Mustermann", "Maximale Wirkung mit minimalem Aufwand", "Wissenswertes für Macher", "Your video, beautifully told", "Make more money with modern marketing", "Kostenlos starten", "Danke fürs Zuschauen!", "Probier es jetzt aus", "Schritt für Schritt erklärt", "Mehr Wirkung. Weniger Klicks.", "Wow, was für ein Wochenmarkt!"];
const browser = await puppeteer.launch({ executablePath: findChrome(), args: ["--no-sandbox", "--allow-file-access-from-files"] });
const page = await browser.newPage();
const rows: string[] = [];
for (const st of STYLES) {
  const sdir = path.join(dir, st.id);
  mkdirSync(sdir, { recursive: true });
  const spec = { version: 1, meta: { title: "m" }, canvas: { width: 100, height: 100, fps: 30 }, scenes: [], layers: [
    { id: "a", type: "text", track: 1, start: 0, duration: 1, frame: { x: 0, y: 0, w: 1, h: 1 }, text: "a", style: { fontSize: 10, fontFamily: st.fonts.display, fontWeight: st.fonts.displayWeight } },
    { id: "b", type: "text", track: 1, start: 0, duration: 1, frame: { x: 0, y: 0, w: 1, h: 1 }, text: "b", style: { fontSize: 10, fontFamily: st.fonts.body, fontWeight: st.fonts.bodyWeight } },
  ] } as unknown as MotionSpec;
  const r = await ensureFonts(spec, sdir);
  const faces = r.op && r.op.op === "style" ? r.op.set.fonts ?? [] : [];
  const css = faces.map((f) => `@font-face{font-family:"${f.family}";src:url("file://${path.join(sdir, f.src)}");font-weight:${f.weight ?? "100 900"}}`).join("\n");
  const html = path.join(sdir, "m.html");
  writeFileSync(html, `<!doctype html><style>${css}</style><body></body>`);
  await page.goto(`file://${html}`, { waitUntil: "load" });
  const m = await page.evaluate(async (fams: [string, number][], corpus: string[]) => {
    const res: number[] = [];
    for (const [fam, w] of fams) {
      await document.fonts.load(`${w} 100px "${fam}"`);
      const ok = [...document.fonts].some((f) => f.family.replace(/"/g, "") === fam && f.status === "loaded");
      const el = document.createElement("span");
      el.style.cssText = `position:absolute;white-space:pre;font-size:100px;font-family:"${fam}",monospace;font-weight:${w}`;
      document.body.appendChild(el);
      let mixed = 0, upper = 0;
      for (const t of corpus) {
        el.textContent = t; mixed = Math.max(mixed, el.getBoundingClientRect().width / t.length / 100);
        el.textContent = t.toUpperCase(); upper = Math.max(upper, el.getBoundingClientRect().width / t.length / 100);
      }
      el.remove();
      res.push(ok ? mixed : -1, ok ? upper : -1);
    }
    return res;
  }, [[st.fonts.display, st.fonts.displayWeight], [st.fonts.body, st.fonts.bodyWeight]], corpus);
  const up = (v: number) => Math.ceil(v * 1.03 * 100) / 100;
  rows.push(`${st.id}: displayWidth ${up(m[0])}, displayUpper ${up(m[1])}, bodyWidth ${up(m[2])}${m.includes(-1) ? "  ⚠ font did not load" : ""}`);
}
await browser.close();
console.log(rows.join("\n"));
