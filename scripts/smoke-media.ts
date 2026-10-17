// Baustein 3a end-to-end: record (fake camera + speech file as microphone), transcribe locally,
// anchor a layer to a word, facecam layout keyframes, upload an image.
// Usage: node scripts/smoke-media.ts [baseUrl] [outDir] [speech.wav]
import puppeteer from "puppeteer-core";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

const base = process.argv[2] ?? "http://localhost:4317";
const out = process.argv[3] ?? "/tmp/om-smoke3";
const speech = process.argv[4] ?? "/tmp/speech.wav";
mkdirSync(out, { recursive: true });
const chrome = process.env.CHROME_PATH ?? execFileSync("npx", ["hyperframes", "browser", "path"], { encoding: "utf8" }).trim().split("\n").pop()!;
const j = async (p: string, init?: RequestInit) => (await fetch(base + p, { ...init, headers: { "content-type": "application/json" } })).json();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const step = (s: string) => console.log("•", s);

await j("/api/settings", { method: "PUT", body: JSON.stringify({ transcription: { provider: "local", language: "de", models: { local: "tiny" } } }) });
const proj = await j("/api/projects", { method: "POST", body: JSON.stringify({ title: "Facecam-Test", template: "blank" }) });
step(`Projekt ${proj.id}`);

const browser = await puppeteer.launch({
  executablePath: chrome,
  args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${speech}`, "--autoplay-policy=no-user-gesture-required"],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
const errors: string[] = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
await page.evaluateOnNewDocument(() => localStorage.setItem("om-lang", "de"));
await page.goto(`${base}/#/p/${proj.id}`, { waitUntil: "networkidle0" });
await page.waitForSelector(".overlay");

const clickText = async (sel: string, text: string) => {
  const ok = await page.evaluate((s, t) => {
    const el = [...document.querySelectorAll(s)].find((e) => e.textContent?.includes(t)) as HTMLElement | undefined;
    el?.click();
    return !!el;
  }, sel, text);
  if (!ok) throw new Error(`nicht gefunden: ${sel} "${text}"`);
};

const clickExact = async (sel: string, text: string) => {
  const ok = await page.evaluate((s, t) => {
    const el = [...document.querySelectorAll(s)].find((e) => e.textContent?.trim() === t) as HTMLElement | undefined;
    el?.click();
    return !!el;
  }, sel, text);
  if (!ok) throw new Error(`nicht gefunden: ${sel} "${text}"`);
};

// 1) Record
await clickText(".tabs button", "Medien");
await clickText(".btnrow button", "Aufnehmen");
await page.waitForSelector(".rec-video");
await sleep(1500);
await clickText(".modal button", "Aufnahme starten");
await sleep(3500 + 7500);
await page.screenshot({ path: `${out}/1-aufnahme.png` });
await clickText(".modal button", "Stopp");
await page.waitForFunction(() => document.body.textContent?.includes("Aufnahme gespeichert"));
step("Aufnahme fertig");
await clickText(".modal button", "Als Facecam einfügen");

// 2) Wait for upload/convert + transcription
await page.waitForFunction(() => document.querySelectorAll(".words .word").length > 3, { timeout: 120_000 });
await sleep(800);
const words = await page.$$eval(".words .word", (els) => els.map((e) => e.textContent));
step(`Transkript: ${words.length} Wörter: ${words.join(" ")}`);

// 3) Anchor the title to the word that contains "Bild" (or the 5th word)
await clickText(".tabs button", "Ebenen");
await clickExact(".lrow .lname > span:first-child", "Titel");
await clickText(".tabs button", "Medien");
await clickText(".btnrow button", "Anker");
const target = words.findIndex((w) => /bild/i.test(w ?? "")) >= 0 ? words.findIndex((w) => /bild/i.test(w ?? "")) : 4;
await page.evaluate((i) => (document.querySelectorAll(".words .word")[i] as HTMLElement).click(), target);
await sleep(500);
await page.screenshot({ path: `${out}/2-transkript-anker.png` });
step(`Titel an Wort #${target + 1} "${words[target]}" gehängt`);

// 4) Facecam layout at 3 s
await page.evaluate(() => {
  const r = document.querySelector('.transport input[type="range"]') as HTMLInputElement;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(r, "3");
  r.dispatchEvent(new Event("input", { bubbles: true }));
});
await clickText(".tabs button", "Ebenen");
await clickExact(".lrow .lname > span:first-child", "Facecam");
await clickText(".tabs button", "Tweaks");
await clickText(".btnrow button", "Ecke");
await sleep(1200);
await page.screenshot({ path: `${out}/3-layout-ecke.png` });
step("Layout Ecke gesetzt");

// 5) Upload an image through the file input
await clickText(".tabs button", "Medien");
const input = await page.$('input[type="file"]');
await input!.uploadFile(path.resolve("examples/explainer/assets/image.png"));
await page.waitForFunction(() => [...document.querySelectorAll(".asset")].some((a) => a.textContent?.includes("image.png")), { timeout: 30_000 });
await sleep(1500);
await page.screenshot({ path: `${out}/4-medien.png` });
step("Bild hochgeladen");

const data = await j(`/api/projects/${proj.id}`);
const cam = data.spec.layers.find((l: { type: string; name?: string }) => l.type === "video");
const title = data.spec.layers.find((l: { id: string }) => l.id === "title");
console.log(JSON.stringify({
  layers: data.spec.layers.map((l: { id: string; type: string; src?: string }) => `${l.id}:${l.type}${l.src ? ` ${l.src}` : ""}`),
  transcript: { source: data.spec.transcript?.source, provider: data.spec.transcript?.provider, words: data.spec.transcript?.words.length },
  titleAnchor: title.anchor,
  camKeysX: cam?.keys?.x, camRadius: cam?.radius,
  consoleErrors: errors,
}, null, 1));
await browser.close();
