// Still frames of a project, rendered in headless Chrome (same composition as the export).
// Used by the MCP tool "look" (the AI SEES its work and fixes it) and by scripts/frames.ts.

import { existsSync, readdirSync, statSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { compile, compositionDuration, type MotionSpec } from "@openmotion/core";

/** Finds a Chrome: env override, HyperFrames' own headless shell, Playwright's, then system browsers. */
export function findChrome(): string {
  const env = process.env.OPENMOTION_CHROME ?? process.env.HYPERFRAMES_BROWSER_PATH ?? process.env.PRODUCER_HEADLESS_SHELL_PATH;
  if (env && existsSync(env)) return env;
  const exe = process.platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell";
  const found = findFile(path.join(os.homedir(), ".cache", "hyperframes", "chrome"), exe, 6);
  if (found) return found;
  const candidates = process.platform === "darwin"
    ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
    : process.platform === "win32"
      ? [path.join(process.env.PROGRAMFILES ?? "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"), path.join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe")]
      : ["/opt/pw-browsers/chromium", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  const sys = candidates.find((c) => existsSync(c));
  if (sys) return sys;
  throw new Error("Kein Chrome gefunden. Einmal ausführen: npx hyperframes browser ensure (der Installer macht das automatisch).");
}

function findFile(dir: string, name: string, depth: number): string | null {
  if (depth < 0 || !existsSync(dir)) return null;
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isFile() && e === name) return p;
    if (st.isDirectory()) {
      const r = findFile(p, name, depth - 1);
      if (r) return r;
    }
  }
  return null;
}

export interface FrameShot { t: number; png: Buffer }

/** Renders frames at the given seconds (default: 6 spread over the video). Scale 0.5 = half size (cheap for AI eyes). */
export async function renderFrames(spec: MotionSpec, projectDir: string, times?: number[], scale = 0.5): Promise<FrameShot[]> {
  const { default: puppeteer } = await import("puppeteer-core");
  const c = compile(spec, { scale });
  const d = compositionDuration(spec);
  const ts = (times?.length ? times : Array.from({ length: 6 }, (_, i) => ((i + 0.5) / 6) * d)).map((t) => Math.max(0, Math.min(d - 0.001, t))).slice(0, 12);
  const html = path.join(projectDir, `.frames-${randomBytes(4).toString("hex")}.html`);
  await writeFile(html, c.html);
  const browser = await puppeteer.launch({ executablePath: findChrome(), args: ["--no-sandbox", "--allow-file-access-from-files", "--autoplay-policy=no-user-gesture-required"], defaultViewport: { width: c.width, height: c.height } });
  try {
    const page = await browser.newPage();
    await page.goto(`file://${html.replace(/\\/g, "/")}`, { waitUntil: "load", timeout: 60_000 });
    await page.evaluate(() => document.fonts.ready);
    const out: FrameShot[] = [];
    for (const t of ts) {
      await page.evaluate((x) => (window as unknown as { __om: { seek(t: number): void } }).__om.seek(x), t);
      // Videos need a moment to show the sought frame.
      await page.evaluate(() => Promise.all([...document.querySelectorAll("video")].map((v) => (v.readyState >= 2 ? null : new Promise((r) => { v.addEventListener("seeked", r, { once: true }); setTimeout(r, 1500); })))));
      await new Promise((r) => setTimeout(r, 60));
      out.push({ t: Math.round(t * 100) / 100, png: Buffer.from(await page.screenshot({ type: "png" })) });
    }
    return out;
  } finally {
    await browser.close();
    await rm(html, { force: true });
  }
}
