// Captures the README screenshots from the English UI. Staged state is prepared via the API.
// Usage: node scripts/screenshots.ts <outDir>   (needs CHROME_PATH or hyperframes browser)
import puppeteer from "puppeteer-core";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { applyPatch, type MotionSpec } from "@openmotion/core";

const out = process.argv[2] ?? "docs/assets";
const data = "/tmp/om-shots";
const port = 4340;
const base = `http://127.0.0.1:${port}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
rmSync(data, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const server = spawn("node", ["packages/server/src/main.ts"], { env: { ...process.env, OPENMOTION_DATA: data, PORT: String(port), OPENMOTION_ROLE: "all", OPENMOTION_PASSWORD: "" }, stdio: "ignore" });
const j = async (p: string, init: RequestInit = {}) => (await fetch(base + p, { ...init, headers: { "content-type": "application/json" } })).json();
try {
  for (let i = 0; i < 40; i++) { try { await fetch(`${base}/api/health`); break; } catch { await sleep(300); } }
  const proj = await j("/api/projects", { method: "POST", body: JSON.stringify({ title: "Explainer", template: "example", lang: "en" }) });
  const { spec } = (await j(`/api/projects/${proj.id}`)) as { spec: MotionSpec };
  const staged = applyPatch(spec, [
    { op: "set", id: "s1-title", path: "style.color", value: "$accent" },
    { op: "set", id: "s1-icon", path: "frame.rotation", value: 6 },
    { op: "add", layer: { id: "ki-layers", name: "Keyword", type: "text", track: 7, start: 0, duration: 2.4, anchor: { word: "w15", offset: -0.2 }, frame: { x: 1080, y: 400, w: 380, h: 110 }, text: "LAYERS", style: { fontSize: 80, fontWeight: 800, color: "$accent", letterSpacing: 2 }, in: { type: "pop" }, out: { type: "fade" } } },
  ]).spec;
  await j(`/api/projects/${proj.id}/spec`, { method: "PUT", body: JSON.stringify(staged) });
  await j(`/api/projects/${proj.id}/comments`, { method: "PUT", body: JSON.stringify([{ t: 1.2, layer: "s1-icon", x: 400, y: 700, text: "@AI tilt the film strip a little", toAI: true, status: "done", reply: "Tilted the film strip by 6°. Only this layer changed." }]) });
  const now = new Date().toISOString();
  await j(`/api/projects/${proj.id}/chat`, { method: "PUT", body: JSON.stringify([
    { id: "m1", role: "user", text: "Make the title in scene 1 orange.", at: now },
    { id: "m2", role: "assistant", text: "Done: the scene 1 title now uses your accent color. Nothing else changed.", at: now, ops: 1, changed: ["s1-title"] },
    { id: "m3", role: "user", text: "💬 0:01.2: @AI tilt the film strip a little", at: now },
    { id: "m4", role: "assistant", text: "Tilted “Film strip with lock” by 6°. Only this layer changed.", at: now, ops: 1 },
    { id: "m5", role: "user", text: "✨ Graphics from transcript", at: now },
    { id: "m6", role: "assistant", text: "Added the keyword “LAYERS”, anchored to the spoken word “layer.” It moves along when you cut.", at: now, ops: 1 },
  ]) });

  const chrome = process.env.CHROME_PATH ?? execFileSync("npx", ["hyperframes", "browser", "path"], { encoding: "utf8" }).trim().split("\n").pop()!;
  const b = await puppeteer.launch({ executablePath: chrome, args: ["--no-sandbox"], defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 1 } });
  const page = await b.newPage();
  await page.evaluateOnNewDocument(() => localStorage.setItem("om-lang", "en"));
  const open = async () => { await page.goto(`${base}/?r=${Date.now()}#/p/${proj.id}`, { waitUntil: "networkidle0" }); await page.waitForSelector(".overlay"); await sleep(800); };
  const seek = async (t: number) => {
    await page.evaluate((v) => { const r = document.querySelector('.transport input[type="range"]') as HTMLInputElement; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(r, String(v)); r.dispatchEvent(new Event("input", { bubbles: true })); }, t);
    await sleep(700);
  };
  const tab = (i: number) => page.evaluate((k) => (document.querySelectorAll(".tabs button")[k] as HTMLElement).click(), i);
  const clickText = (sel: string, txt: string) => page.evaluate((s, t) => { (([...document.querySelectorAll(s)].find((e) => e.textContent?.includes(t))) as HTMLElement)?.click(); }, sel, txt);
  const stage = async (cx: number, cy: number) => { const r = await page.$eval(".overlay", (e) => { const x = e.getBoundingClientRect(); return { x: x.left, y: x.top, w: x.width }; }); const k = r.w / 1920; await page.mouse.click(r.x + cx * k, r.y + cy * k); await sleep(400); };

  // 1) AI chat (chat open, scene 2 with anchored keyword)
  await open();
  await seek(6.95);
  await page.screenshot({ path: `${out}/ai-chat.png` });
  // 2) Live editor (chat closed, facecam selected)
  await page.click(".chat-head button");
  await seek(1.2);
  await stage(1440, 540);
  await page.screenshot({ path: `${out}/editor.png` });
  // 3) Transcript + anchors (image layer selected, anchor mode)
  await seek(11.0);
  await stage(450, 640);
  await tab(2);
  await sleep(400);
  await clickText(".btnrow button", "Anchor");
  await sleep(400);
  await page.screenshot({ path: `${out}/transcript-anchors.png` });
  // 4) Export dialog
  await page.click(".top button.primary");
  await page.waitForSelector(".modal");
  await sleep(1200);
  await page.screenshot({ path: `${out}/export.png` });
  // 5) Text-based cutting (cuts applied, cut mode)
  const cur = (await j(`/api/projects/${proj.id}`)).spec as MotionSpec;
  const cutSpec = applyPatch(cur, [{ op: "cut", t0: 0.82, t1: 1.4, reason: "manual" }, { op: "cut", t0: 2.95, t1: 4.35, reason: "pause" }]).spec;
  await j(`/api/projects/${proj.id}/spec`, { method: "PUT", body: JSON.stringify(cutSpec) });
  await open();
  if (await page.$(".chat-head button")) await page.click(".chat-head button");
  await seek(0.3);
  await tab(2);
  await sleep(400);
  await clickText(".btnrow button", "✂");
  await sleep(300);
  await page.evaluate(() => (document.querySelectorAll(".words .word")[0] as HTMLElement).click());
  await sleep(400);
  await page.screenshot({ path: `${out}/text-cut.png` });
  await b.close();
  console.log("screenshots ok");
} finally {
  server.kill();
}
