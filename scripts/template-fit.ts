// Renders every template in every format with real fonts and checks the layout in Chrome:
// text must fit its box, texts must not overlap, nothing important may leave the canvas.
//   node scripts/template-fit.ts <outDir> [styleIds,comma] [templateIds,comma]
//   OM_FIT_LONG=1 fills every field with long texts (stress test: users write more than the defaults).
// Writes a contact sheet per style+format (<outDir>/<style>-<format>.png) for a visual review.
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { applyPatch, compile, FORMATS, STYLES, TEMPLATES, templateOps, type MotionSpec } from "@openmotion/core";
import { blankSpec } from "../packages/server/src/store.ts";
import { ensureFonts } from "../packages/server/src/fonts.ts";
import { findChrome } from "../packages/server/src/frames.ts";
import puppeteer from "puppeteer-core";

const [out, styleArg, tplArg] = process.argv.slice(2);
if (!out) { console.error("usage: node scripts/template-fit.ts <outDir> [styles] [templates]"); process.exit(1); }
const styles = styleArg ? STYLES.filter((s) => styleArg.split(",").includes(s.id)) : STYLES;
const templates = tplArg ? TEMPLATES.filter((t) => tplArg.split(",").includes(t.id)) : TEMPLATES;
const browser = await puppeteer.launch({ executablePath: findChrome(), args: ["--no-sandbox", "--allow-file-access-from-files"] });
const page = await browser.newPage();
const problems: string[] = [];
for (const st of styles) {
  const fontDir = path.join(out, `fonts-${st.id}`);
  mkdirSync(fontDir, { recursive: true });
  for (const f of FORMATS) {
    const base = blankSpec("de", { format: f, style: st.id });
    const shots: string[] = [];
    for (const t of templates) {
      let spec: MotionSpec = { ...base, layers: base.layers.filter((l) => l.id === "bg") };
      const long: Record<string, string> = {};
      if (process.env.OM_FIT_LONG === "1") for (const fld of t.fields) {
        long[fld.key] = fld.type === "number" ? "1234567" : fld.type === "lines"
          ? (fld.key === "items" && t.id === "timeline" ? "Frühjahr 2024 | Die erste Idee entsteht beim Kaffee mit dem Team\nHerbst 2025 | Die erste öffentliche Version geht online\nSommer 2026 | Zehntausend Menschen nutzen es jeden Tag" : fld.key === "items" && t.id === "stats" ? "1.250.000 € | Umsatz im ersten Jahr nach dem Start\n37 % | mehr wiederkehrende Kundinnen und Kunden\n4,9 | durchschnittliche Bewertung" : fld.key === "items" && t.id === "bars" ? "Klassischer Videoschnitt mit Agentur: 340\nMit Vorlagen aus dem Internet: 125\nOpen Motion mit KI: 18" : "Ein deutlich längerer Punkt als vorgesehen\nNoch ein Punkt mit Überlänge und vielen Wörtern\nDer dritte Punkt ist ebenfalls ziemlich ausführlich formuliert")
          : fld.key === "prefix" || fld.key === "suffix" || fld.key === "unit" || fld.key === "num" ? (fld.key === "unit" ? " Minuten" : fld.key === "num" ? "1250" : fld.key === "suffix" ? " Kunden" : "") : "Ein deutlich längerer Text als vorgesehen, mit Wörtern wie Datenschutzgrundverordnung";
      }
      const r = templateOps(spec, t.id, long, 0.2);
      spec = applyPatch(spec, r.ops).spec;
      const fonts = await ensureFonts(spec, fontDir).catch(() => null);
      if (fonts?.op) spec = applyPatch(spec, [fonts.op]).spec;
      const c = compile(spec);
      const html = path.join(fontDir, `${t.id}-${f.replace(":", "x")}.html`);
      writeFileSync(html, c.html);
      await page.setViewport({ width: c.width, height: c.height });
      await page.goto(`file://${html}`, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      const tpl = t.kind === "scene" ? r.at + t.duration - 0.6 : r.at + Math.min(t.duration - 0.4, 2.2);
      await page.evaluate((x) => (window as any).__om.seek(x), tpl);
      await new Promise((res) => setTimeout(res, 60));
      const found = await page.evaluate((ids: string[], W: number, H: number) => {
        const res: string[] = [];
        const boxes: { id: string; r: DOMRect }[] = [];
        for (const id of ids) {
          const el = document.getElementById(`om-${id}`);
          const content = document.getElementById(`om-c-${id}`);
          if (!el || !content || el.dataset.omType !== "text" || getComputedStyle(content).visibility === "hidden") continue;
          if (+getComputedStyle(el).opacity < 0.05) continue;
          const decorative = /-mark$/.test(id);
          // Overflow by line boxes (what the layout really occupies), not by glyph ink.
          const tol = 3;
          const lhPx = parseFloat(getComputedStyle(content).lineHeight) || 0;
          let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            const range = document.createRange();
            range.selectNodeContents(walker.currentNode);
            for (const rr of range.getClientRects()) {
              if (!rr.width) continue;
              const h = lhPx ? Math.min(rr.height, lhPx) : rr.height;
              const cy = rr.top + rr.height / 2;
              x0 = Math.min(x0, rr.left); y0 = Math.min(y0, cy - h / 2); x1 = Math.max(x1, rr.right); y1 = Math.max(y1, cy + h / 2);
            }
          }
          if (x0 === Infinity) continue;
          const box = content.getBoundingClientRect();
          // Rotated layers: their bounding boxes grow with the tilt, so only the canvas check applies.
          const rotated = /rotate/.test(el.getAttribute("style") ?? "") && !/rotate:\s*0deg/.test(el.getAttribute("style") ?? "");
          if (!decorative && !rotated && (x1 - x0 > box.width + tol || x0 < box.left - tol || x1 > box.right + tol || y0 < box.top - tol || y1 > box.bottom + tol))
            res.push(`${id}: text ${Math.round(x0 - box.left)},${Math.round(y0 - box.top)} ${Math.round(x1 - x0)}×${Math.round(y1 - y0)} outside box ${Math.round(box.width)}×${Math.round(box.height)}`);
          if (!decorative && (x0 < -1 || y0 < -1 || x1 > W + 1 || y1 > H + 1)) res.push(`${id}: leaves the canvas`);
          if (!decorative) boxes.push({ id, r: new DOMRect(x0, y0, x1 - x0, y1 - y0) });
        }
        for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i].r, b = boxes[j].r;
          const ix = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
          const iy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
          if (ix * iy > 0.04 * Math.min(a.width * a.height, b.width * b.height)) res.push(`overlap ${boxes[i].id} × ${boxes[j].id}`);
        }
        return res;
      }, r.layers, c.width, c.height);
      for (const p of found) problems.push(`${st.id} ${f} ${t.id}: ${p}`);
      const shot = path.join(fontDir, `${t.id}-${f.replace(":", "x")}.png`);
      await page.screenshot({ path: shot as `${string}.png` });
      shots.push(shot);
    }
    writeFileSync(path.join(out, `${st.id}-${f.replace(":", "x")}.json`), JSON.stringify(shots));
  }
}
await browser.close();
console.log(problems.length ? problems.join("\n") : "ALL TEMPLATES FIT");
console.log(`${problems.length} problem(s)`);
void existsSync;
