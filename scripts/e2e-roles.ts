// End-to-end like in Coolify: app and worker as two separate processes sharing one data folder.
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const data = "/tmp/om-e2e";
const port = 4330;
const base = `http://127.0.0.1:${port}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const step = (s: string) => console.log(`• [${((Date.now() - T0) / 1000).toFixed(1)} s]`, s);
rmSync(data, { recursive: true, force: true });
mkdirSync(data, { recursive: true });
if (existsSync("/tmp/om-models")) cpSync("/tmp/om-models", path.join(data, "models"), { recursive: true });

// 0) Without password the app must refuse to start when auth is required
const refuse = spawnSync("node", ["packages/server/src/main.ts"], { env: { ...process.env, OPENMOTION_ROLE: "app", OPENMOTION_REQUIRE_AUTH: "1", OPENMOTION_PASSWORD: "", PORT: "4331", OPENMOTION_DATA: data }, encoding: "utf8", timeout: 10000 });
step(`Ohne Passwort: Exit ${refuse.status}, „${refuse.stderr.trim().slice(0, 60)}…"`);

const common = { ...process.env, OPENMOTION_DATA: data, OPENMOTION_REQUIRE_AUTH: "1", OPENMOTION_PASSWORD: "test-pw" };
const app = spawn("node", ["packages/server/src/main.ts"], { env: { ...common, OPENMOTION_ROLE: "app", PORT: String(port) }, stdio: "ignore" });
const worker = spawn("node", ["packages/server/src/main.ts"], { env: { ...common, OPENMOTION_ROLE: "worker" }, stdio: "ignore" });
try {
  for (let i = 0; i < 40; i++) { try { const h = await (await fetch(`${base}/api/health`)).json(); if (h.worker?.online) break; } catch { /* starting */ } await sleep(500); }
  const health = await (await fetch(`${base}/api/health`)).json();
  step(`Health: role=${health.role}, Worker online=${health.worker?.online}`);
  step(`Ohne Login: /api/projects → ${(await fetch(`${base}/api/projects`)).status}`);

  const login = await fetch(`${base}/api/auth/login`, { method: "POST", body: JSON.stringify({ password: "test-pw" }) });
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const tok = (await (await fetch(`${base}/api/tokens`, { method: "POST", headers: { cookie, "x-om": "1" }, body: JSON.stringify({ name: "E2E-KI" }) })).json()).token as string;
  const H = { authorization: `Bearer ${tok}`, "content-type": "application/json" };
  const j = async (p: string, init: RequestInit = {}) => (await fetch(base + p, { ...init, headers: { ...H, ...(init.headers ?? {}) } })).json();
  step(`Token erstellt: ${tok.slice(0, 7)}…`);

  await j("/api/settings", { method: "PUT", body: JSON.stringify({ transcription: { provider: "local", language: "de", models: { local: "tiny" } } }) });
  const proj = await j("/api/projects", { method: "POST", body: JSON.stringify({ title: "Zwei Dienste", template: "example" }) });
  const up = await (await fetch(`${base}/api/projects/${proj.id}/upload?name=sprache.wav`, { method: "POST", headers: { authorization: H.authorization }, body: readFileSync("/tmp/speech.wav") })).json();
  const tr = await j(`/api/projects/${proj.id}/transcribe`, { method: "POST", body: JSON.stringify({ source: up.path, provider: "local" }) });
  const ex = await j(`/api/projects/${proj.id}/export`, { method: "POST", body: JSON.stringify({ format: "mp4", height: 360, fps: 15, quality: "low" }) });
  step(`Aufträge eingereiht: Transkript ${tr.id}, Export ${ex.id} (Schätzung ${ex.estimateSeconds} s, Plan: ${ex.plan?.reason})`);

  const wait = async (id: string) => { for (let i = 0; i < 240; i++) { const s = await j(`/api/jobs/${id}`); if (s.status === "done" || s.status === "error") return s; await sleep(1000); } return { status: "timeout" }; };
  const t = await wait(tr.id);
  step(`Transkript vom Worker: ${t.status}, ${t.result?.words?.length ?? 0} Wörter (${t.result?.words?.slice(0, 6).map((w: { text: string }) => w.text).join(" ")} …), Worker ${t.worker}`);
  const e = await wait(ex.id);
  const file = e.file ? path.join(data, "projects", proj.id, e.file) : "";
  step(`Export vom Worker: ${e.status}, ${e.file} (${Math.round((e.size ?? 0) / 1024)} KB), Datei da: ${file && existsSync(file)}${e.error ? ` Fehler: ${e.error}` : ""}`);

  // Browser: login page and token section
  const chrome = process.env.CHROME_PATH!;
  const b = await puppeteer.launch({ executablePath: chrome, args: ["--no-sandbox"], defaultViewport: { width: 1280, height: 860 } });
  const page = await b.newPage();
  await page.evaluateOnNewDocument(() => localStorage.setItem("om-lang", "de"));
  await page.goto(base, { waitUntil: "networkidle0" });
  await page.screenshot({ path: "/tmp/om-e2e-login.png" });
  await page.type('input[type="password"]', "test-pw");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".prow");
  await page.click(".prow");
  await page.waitForSelector(".overlay");
  await page.click('button[aria-label="Einstellungen"]');
  await page.waitForSelector(".keyrow");
  await sleep(500);
  await page.evaluate(() => document.querySelector(".modal")!.scrollTo(0, 99999));
  await page.screenshot({ path: "/tmp/om-e2e-settings.png" });
  step("Browser: Anmeldung → Projekt → Einstellungen ok");
  await b.close();
} finally {
  app.kill();
  worker.kill();
}
