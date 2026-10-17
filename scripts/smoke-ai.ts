// Baustein 4 end-to-end in test mode (server started with OPENMOTION_FAKE_AI=1, no network):
// chat → change + flash → undo → comment worked off by AI → graphics from transcript → AI image on a layer.
import puppeteer from "puppeteer-core";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:4317";
const out = process.argv[3] ?? "/tmp/om-smoke-ai";
mkdirSync(out, { recursive: true });
const chrome = process.env.CHROME_PATH ?? execFileSync("npx", ["hyperframes", "browser", "path"], { encoding: "utf8" }).trim().split("\n").pop()!;
const j = async (p: string, init?: RequestInit) => (await fetch(base + p, { ...init, headers: { "content-type": "application/json" } })).json();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const step = (s: string) => console.log("•", s);

const proj = await j("/api/projects", { method: "POST", body: JSON.stringify({ title: "KI-Test", template: "example" }) });
const layers = async () => (await j(`/api/projects/${proj.id}`)).spec.layers as { id: string; type: string; src?: string; frame?: { rotation?: number }; anchor?: unknown }[];
const browser = await puppeteer.launch({ executablePath: chrome, args: ["--no-sandbox"], defaultViewport: { width: 1600, height: 900 } });
const page = await browser.newPage();
const errors: string[] = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
await page.evaluateOnNewDocument(() => localStorage.setItem("om-lang", "de"));
await page.goto(`${base}/#/p/${proj.id}`, { waitUntil: "networkidle0" });
await page.waitForSelector(".chat textarea");
const click = async (sel: string, text: string) => {
  const ok = await page.evaluate((s, t) => { const el = [...document.querySelectorAll(s)].find((e) => e.textContent?.includes(t)) as HTMLElement | undefined; el?.click(); return !!el; }, sel, text);
  if (!ok) throw new Error(`nicht gefunden: ${sel} "${text}"`);
};
const assistantCount = () => page.$$eval(".msg.assistant", (els) => els.length);
const waitAssistant = async (n: number) => page.waitForFunction((k) => document.querySelectorAll(".msg.assistant").length >= k && !document.querySelector(".thinking"), { timeout: 30_000 }, n);

// 1) Chat
await page.type(".chat textarea", "Bitte ein Bild und einen Text einfügen");
await page.keyboard.press("Enter");
await waitAssistant(1);
await sleep(300);
await page.screenshot({ path: `${out}/1-chat.png` });
let ls = await layers();
await sleep(900);
ls = await layers();
step(`Chat: ${ls.filter((l) => l.id.startsWith("ki-")).map((l) => `${l.id}:${l.type}${l.src ? ` ${l.src}` : ""}`).join(", ")}`);

// 2) Undo this answer
await click(".msg.assistant .meta button", "Rückgängig");
await sleep(1200);
ls = await layers();
step(`Rückgängig: ki-Ebenen übrig = ${ls.filter((l) => l.id.startsWith("ki-")).length}`);

// 3) Comment on the film strip at 1.2 s, then let the AI work it off
await page.evaluate(() => {
  const r = document.querySelector('.transport input[type="range"]') as HTMLInputElement;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(r, "1.2");
  r.dispatchEvent(new Event("input", { bubbles: true }));
});
await sleep(500);
const box = await page.$eval(".overlay", (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width }; });
const k = box.w / 1920;
await page.click('button[aria-label="Kommentar-Modus"]');
await page.mouse.click(box.x + 400 * k, box.y + 700 * k);
await page.waitForSelector(".popover textarea");
await page.type(".popover textarea", "@KI dreh das Schloss etwas");
await click(".popover button", "Speichern");
await sleep(600);
await page.click('button[aria-label="Kommentar-Modus"]');
await click(".chat .quick button", "Kommentare abarbeiten");
await waitAssistant(2);
await sleep(1200);
const data = await j(`/api/projects/${proj.id}`);
step(`Kommentar: Status ${data.comments[0].status}, Antwort „${data.comments[0].reply}", s1-icon rotation = ${data.spec.layers.find((l: { id: string }) => l.id === "s1-icon").frame.rotation}`);

// 4) Graphics from transcript
await click(".chat .quick button", "Grafiken aus Transkript");
await waitAssistant(3);
await sleep(1200);
ls = await layers();
const kw = ls.find((l) => l.id.startsWith("ki-stichwort"));
step(`Transkript-Grafik: ${kw?.id} verankert an ${JSON.stringify(kw?.anchor)}`);

// 5) AI image on the existing image layer s3-bild
await click(".tabs button", "Ebenen");
await page.evaluate(() => ([...document.querySelectorAll(".lrow .lname > span:first-child")].find((e) => e.textContent === "AI image") as HTMLElement).click());
await click(".tabs button", "Tweaks");
await page.waitForSelector(".tabbody textarea");
await page.evaluate(() => { const b = [...document.querySelectorAll(".tabbody button")].find((e) => e.textContent?.includes("Generieren")) as HTMLButtonElement; b.click(); });
await page.waitForFunction(() => ![...document.querySelectorAll(".tabbody button")].some((e) => e.textContent?.includes("Generiert")), { timeout: 30_000 });
await sleep(1500);
await page.screenshot({ path: `${out}/2-nach-ki.png` });
ls = await layers();
step(`KI-Bild: s3-bild src = ${ls.find((l) => l.id === "s3-bild")?.src}`);
const chat = await j(`/api/projects/${proj.id}/chat`);
step(`Chat gespeichert: ${chat.length} Einträge. Konsolenfehler: ${JSON.stringify(errors)}`);
await browser.close();
