import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer, fromDeepgram, fromElevenLabs, fromOpenAI, runWorker, safeName, withIds } from "@openmotion/server";

const root = path.resolve(import.meta.dirname, "../../..");
async function start() {
  const data = await mkdtemp(path.join(os.tmpdir(), "om-media-"));
  const server = createServer({ dataDir: data, examplesDir: path.join(root, "examples/explainer") });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  const api = (p: string, init?: RequestInit) => fetch(`http://127.0.0.1:${port}${p}`, init);
  const ac = new AbortController();
  void runWorker(data, ac.signal);
  const stop = () => { ac.abort(); server.closeAllConnections(); server.close(); };
  return { data, api, stop };
}

test("settings: keys go in, never come out; file is private", async () => {
  const { data, api, stop } = await start();
  const r = await api("/api/settings", { method: "PUT", body: JSON.stringify({ keys: { openai: "sk-test-1234567890abcd" }, transcription: { provider: "groq", language: "de" } }) });
  const pub = (await r.json()) as { keys: Record<string, { set: boolean; hint?: string }>; transcription: { provider: string } };
  assert.deepEqual(pub.keys.openai, { set: true, hint: "…abcd" });
  assert.equal(pub.transcription.provider, "groq");
  assert.doesNotMatch(JSON.stringify(await (await api("/api/settings")).json()), /sk-test/);
  const mode = (await stat(path.join(data, "settings.json"))).mode & 0o777;
  assert.equal(mode, 0o600);
  await api("/api/settings", { method: "PUT", body: JSON.stringify({ keys: { openai: "" } }) });
  assert.equal(((await (await api("/api/settings")).json()) as typeof pub).keys.openai.set, false);
  stop();
});

test("upload: image sorted, browser WebM becomes seekable MP4 with metadata", async () => {
  const { data, api, stop } = await start();
  const p = (await (await api("/api/projects", { method: "POST", body: JSON.stringify({ title: "Upload", template: "blank" }) })).json()) as { id: string };
  const png = await readFile(path.join(root, "examples/explainer/assets/image.png"));
  const img = (await (await api(`/api/projects/${p.id}/upload?name=Mein Bild (1).PNG`, { method: "POST", body: png })).json()) as { path: string; width: number };
  assert.equal(img.path, "assets/images/mein-bild-1.png");
  assert.equal(img.width, 1200);
  const webm = path.join(data, "rec.webm");
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=25", "-f", "lavfi", "-i", "sine=f=300", "-t", "2", "-c:v", "libvpx", "-c:a", "libopus", webm]);
  const vid = (await (await api(`/api/projects/${p.id}/upload?name=aufnahme.webm`, { method: "POST", body: await readFile(webm) })).json()) as { path: string; converted: boolean; duration: number; hasAudio: boolean; vcodec: string };
  assert.equal(vid.path, "assets/video/aufnahme.mp4");
  assert.equal(vid.converted, true);
  assert.equal(vid.vcodec, "h264");
  assert.equal(vid.hasAudio, true);
  assert.ok(Math.abs(vid.duration - 2) < 0.15);
  const bad = await api(`/api/projects/${p.id}/upload?name=virus.exe`, { method: "POST", body: "x" });
  assert.equal(bad.status, 415);
  stop();
});

test("transcribe without key fails with a helpful message", async () => {
  const { api, stop } = await start();
  const p = (await (await api("/api/projects", { method: "POST", body: JSON.stringify({ title: "STT", template: "example" }) })).json()) as { id: string };
  const task = (await (await api(`/api/projects/${p.id}/transcribe`, { method: "POST", body: JSON.stringify({ source: "assets/video/facecam.mp4", provider: "deepgram" }) })).json()) as { id: string };
  let t: { status: string; error?: string } = { status: "queued" };
  for (let i = 0; i < 50 && (t.status === "queued" || t.status === "running"); i++) {
    await new Promise((r) => setTimeout(r, 100));
    t = (await (await api(`/api/tasks/${task.id}`)).json()) as typeof t;
  }
  assert.equal(t.status, "error");
  assert.match(t.error!, /Kein API-Key für Deepgram/);
  const outside = await api(`/api/projects/${p.id}/transcribe`, { method: "POST", body: JSON.stringify({ source: "../../settings.json" }) });
  assert.equal(outside.status, 422);
  stop();
});

test("provider responses normalize to the same word list", () => {
  const want = [{ text: "Hallo", t0: 0.1, t1: 0.5 }, { text: "Welt.", t0: 0.6, t1: 1 }];
  assert.deepEqual(fromOpenAI({ words: [{ word: " Hallo", start: 0.1, end: 0.5 }, { word: "Welt.", start: 0.6, end: 1.0 }] }), want);
  assert.deepEqual(fromElevenLabs({ words: [{ text: "Hallo", start: 0.1, end: 0.5, type: "word" }, { text: " ", start: 0.5, end: 0.6, type: "spacing" }, { text: "Welt.", start: 0.6, end: 1, type: "word" }, { text: "(lacht)", start: 1, end: 1.2, type: "audio_event" }] }), want);
  assert.deepEqual(fromDeepgram({ results: { channels: [{ alternatives: [{ words: [{ word: "hallo", punctuated_word: "Hallo", start: 0.1, end: 0.5 }, { word: "welt", punctuated_word: "Welt.", start: 0.6, end: 1 }] }] }] } }), want);
  const ids = withIds(want).map((w) => w.id);
  assert.match(ids[0], /^w[0-9a-f]{4}-1$/);
  assert.equal(safeName("Übung Größe.MOV"), "ubung-grosse.mov");
});
