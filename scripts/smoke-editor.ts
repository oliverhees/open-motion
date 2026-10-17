// Clicks through the editor in headless Chrome: create project, select, drag, type, comment, export dialog.
// Usage: node scripts/smoke-editor.ts [baseUrl] [outDir]   (server must run; CHROME_PATH optional)
import puppeteer from "puppeteer-core";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:4317";
const out = process.argv[3] ?? "/tmp/om-smoke";
mkdirSync(out, { recursive: true });
const chrome = process.env.CHROME_PATH ?? execFileSync("npx", ["hyperframes", "browser", "path"], { encoding: "utf8" }).trim().split("\n").pop()!;
const browser = await puppeteer.launch({ executablePath: chrome, args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"], defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage();
const errors: string[] = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
await page.evaluateOnNewDocument(() => localStorage.setItem("om-lang", "de"));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const step = (s: string) => console.log("•", s);

await page.goto(base, { waitUntil: "networkidle0" });
await page.screenshot({ path: `${out}/1-projekte.png` });
step("Projektliste geladen");

await page.type(".newproj input", "Smoke-Test Erklärvideo");
await page.click(".newproj button.primary");
await page.waitForSelector(".overlay");
await sleep(1500);
const id = await page.evaluate(() => location.hash.split("/")[2]);
step(`Projekt angelegt: ${id}`);

// Seek to 1.2 s
await page.evaluate(() => {
  const r = document.querySelector('.transport input[type="range"]') as HTMLInputElement;
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  set.call(r, "1.2");
  r.dispatchEvent(new Event("input", { bubbles: true }));
});
await sleep(600);
const box = await page.$eval(".overlay", (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width }; });
const k = box.w / 1920;
const at = (cx: number, cy: number) => ({ x: box.x + cx * k, y: box.y + cy * k });
await page.screenshot({ path: `${out}/2-editor.png` });
step("Editor bei 1,2 s");

// Select + drag the facecam 150 px left, 60 px down
const cam = at(1440, 540);
await page.mouse.move(cam.x, cam.y);
await page.mouse.down();
for (let i = 1; i <= 10; i++) await page.mouse.move(cam.x - 15 * k * i, cam.y + 6 * k * i);
await page.mouse.up();
await sleep(1200);
await page.screenshot({ path: `${out}/3-facecam-gezogen.png` });
const label = await page.$eval(".sel-label", (e) => e.textContent);
step(`Auswahl: ${label}`);

// Double-click title, type
const title = at(300, 220);
await page.mouse.click(title.x, title.y, { count: 2 });
await sleep(400);
await page.keyboard.type("Live getippt!");
await sleep(300);
await page.screenshot({ path: `${out}/4-text-tippen.png` });
await page.keyboard.press("Escape");
await sleep(1200);
step("Text getippt");

// Comment on the film strip icon
await page.click('button[aria-label="Kommentar-Modus"]');
const icon = at(400, 700);
await page.mouse.click(icon.x, icon.y);
await page.waitForSelector(".popover textarea");
await page.type(".popover textarea", "@KI mach das Schloss grün");
await page.screenshot({ path: `${out}/5-kommentar.png` });
await page.click(".popover button.primary");
await sleep(800);
await page.screenshot({ path: `${out}/6-kommentare-tab.png` });
step("Kommentar gespeichert");

// Export dialog
await page.click('button[aria-label="Kommentar-Modus"]');
await page.click(".top button.primary");
await page.waitForSelector(".modal");
await page.screenshot({ path: `${out}/7-export-dialog.png` });
step("Export-Dialog offen");

const data = await (await fetch(`${base}/api/projects/${id}`)).json();
const camLayer = data.spec.layers.find((l: { id: string }) => l.id === "cam");
const titleLayer = data.spec.layers.find((l: { id: string }) => l.id === "s1-title");
console.log(JSON.stringify({
  id,
  camKeysX: camLayer.keys.x,
  title: titleLayer.text,
  comments: data.comments.map((c: { t: number; layer?: string; text: string; status: string }) => ({ t: c.t, layer: c.layer, text: c.text, status: c.status })),
  consoleErrors: errors,
}, null, 1));
await browser.close();
