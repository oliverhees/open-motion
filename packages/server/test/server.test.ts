import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "@openmotion/server";

const root = path.resolve(import.meta.dirname, "../../..");

async function start() {
  const data = await mkdtemp(path.join(os.tmpdir(), "om-srv-"));
  const server = createServer({ dataDir: data, examplesDir: path.join(root, "examples/explainer") });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  const api = (p: string, init?: RequestInit) => fetch(`http://127.0.0.1:${port}${p}`, init);
  return { data, server, api };
}

test("create example project: clean folder structure, assets sorted", async () => {
  const { data, server, api } = await start();
  const res = await api("/api/projects", { method: "POST", body: JSON.stringify({ title: "Mein Erklärvideo", template: "example" }) });
  assert.equal(res.status, 201);
  const p = (await res.json()) as { id: string };
  assert.match(p.id, /^mein-erklarvideo-[0-9a-f]{6}$/);
  const dir = path.join(data, "projects", p.id);
  for (const f of ["project.json", "spec.json", "comments.json", "renders", "history", "assets/images/image.png", "assets/video/facecam.mp4", "assets/audio/music.mp3", "assets/fonts/bricolage-grotesque-latin.woff2"]) {
    assert.ok(existsSync(path.join(dir, f)), f);
  }
  const full = (await (await api(`/api/projects/${p.id}`)).json()) as { spec: { layers: { id: string; src?: string }[] } };
  assert.equal(full.spec.layers.find((l) => l.id === "cam")!.src, "assets/video/facecam.mp4");
  server.closeAllConnections();
  server.close();
});

test("save spec validates, comments persist, range requests work", async () => {
  const { server, api } = await start();
  const p = (await (await api("/api/projects", { method: "POST", body: JSON.stringify({ title: "Test", template: "blank" }) })).json()) as { id: string };
  const { spec } = (await (await api(`/api/projects/${p.id}`)).json()) as { spec: { layers: { frame?: { w: number } }[] } };
  spec.layers[1].frame!.w = -1;
  const bad = await api(`/api/projects/${p.id}/spec`, { method: "PUT", body: JSON.stringify(spec) });
  assert.equal(bad.status, 422);
  assert.match(((await bad.json()) as { error: string }).error, /frame\.w/);
  spec.layers[1].frame!.w = 900;
  assert.equal((await api(`/api/projects/${p.id}/spec`, { method: "PUT", body: JSON.stringify(spec) })).status, 200);
  await api(`/api/projects/${p.id}/comments`, { method: "PUT", body: JSON.stringify([{ t: 1.5, layer: "title", text: "Größer bitte", toAI: true, status: "queued" }]) });
  const after = (await (await api(`/api/projects/${p.id}`)).json()) as { comments: { text: string; status: string }[] };
  assert.equal(after.comments[0].text, "Größer bitte");
  assert.equal(after.comments[0].status, "queued");
  assert.equal((await api(`/projects/${p.id}/assets/..%2F..%2F..%2Fsecret.json`)).status, 403, "path traversal is blocked");
  server.closeAllConnections();
  server.close();
});

test("video files support HTTP Range (needed for seeking)", async () => {
  const { server, api } = await start();
  const p = (await (await api("/api/projects", { method: "POST", body: JSON.stringify({ title: "Range", template: "example" }) })).json()) as { id: string };
  const r = await api(`/projects/${p.id}/assets/video/facecam.mp4`, { headers: { range: "bytes=0-99" } });
  assert.equal(r.status, 206);
  assert.equal((await r.arrayBuffer()).byteLength, 100);
  server.closeAllConnections();
  server.close();
});
