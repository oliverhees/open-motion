// Baustein 3b end-to-end: cut words in the transcript, apply pause suggestions, restore a word, export.
import puppeteer from "puppeteer-core";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:4317";
const out = process.argv[3] ?? "/tmp/om-smoke-cut";
mkdirSync(out, { recursive: true });
const chrome = process.env.CHROME_PATH ?? execFileSync("npx", ["hyperframes", "browser", "path"], { encoding: "utf8" }).trim().split("\n").pop()!;
const j = async (p: string, init?: RequestInit) => (await fetch(base + p, { ...init, headers: { "content-type": "application/json" } })).json();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const step = (s: string) => console.log("•", s);

const proj = await j("/api/projects", { method: "POST", body: JSON.stringify({ title: "Schnitt-Test", template: "example" }) });
const browser = await puppeteer.launch({ executablePath: chrome, args: ["--no-sandbox"], defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage();
const errors: string[] = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
await page.evaluateOnNewDocument(() => localStorage.setItem("om-lang", "de"));
await page.goto(`${base}/#/p/${proj.id}`, { waitUntil: "networkidle0" });
await page.waitForSelector(".overlay");
const click = async (sel: string, text: string, exact = false) => {
  const ok = await page.evaluate((s, t, ex) => {
    const el = [...document.querySelectorAll(s)].find((e) => (ex ? e.textContent?.trim() === t : e.textContent?.includes(t))) as HTMLElement | undefined;
    el?.click();
    return !!el;
  }, sel, text, exact);
  if (!ok) throw new Error(`nicht gefunden: ${sel} "${text}"`);
};
const words = () => page.$$(".words .word");

await click(".tabs button", "Medien");
await page.waitForSelector(".words .word");
await click(".btnrow button", "Schnitt");
await (await words())[0].click();
await page.keyboard.down("Shift");
await (await words())[1].click();
await page.keyboard.up("Shift");
await page.keyboard.press("Delete");
await sleep(400);
step('Wörter Videos + bearbeiten geschnitten');
await click(".sec h3 button", "Alle anwenden");
await sleep(400);
step("Pausen-Vorschläge angewendet");
await click(".words .word", "Editing", true);
await sleep(600);
step('Wort Videos zurückgeholt');
await page.screenshot({ path: `${out}/schnitt.png` });
await sleep(1200);

const data = await j(`/api/projects/${proj.id}`);
console.log("Schnitte:", JSON.stringify(data.spec.transcript.cuts), "Fehler:", JSON.stringify(errors));
await browser.close();

const job = await j(`/api/projects/${proj.id}/export`, { method: "POST", body: JSON.stringify({ format: "mp4", height: 720, fps: 15, quality: "low" }) });
let st = job;
for (let i = 0; i < 100 && (st.status === "queued" || st.status === "running"); i++) { await sleep(3000); st = await j(`/api/jobs/${job.id}`); }
console.log("Export:", st.status, st.file ?? st.error);
console.log("PROJECT", proj.id);
