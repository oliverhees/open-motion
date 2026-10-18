import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import http from "node:http";
import path from "node:path";
import { Auth, FileQueue, createServer, mcpRoute } from "@openmotion/server";

const root = path.resolve(import.meta.dirname, "../../..");
const facecam = path.join(root, "examples/explainer/assets/facecam.mp4");

async function start() {
  const data = await mkdtemp(path.join(os.tmpdir(), "om-mcp-"));
  const server = createServer({ dataDir: data, examplesDir: path.join(root, "examples/explainer"), extra: mcpRoute() });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  let n = 0;
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const call = async (name: string, args: Record<string, unknown> = {}, headers?: Record<string, string>) => {
    const res = await post({ jsonrpc: "2.0", id: ++n, method: "tools/call", params: { name, arguments: args } }, headers);
    const j = (await res.json()) as { result: { content: { text: string }[]; isError?: boolean } };
    const text = j.result.content[0].text;
    return { text, error: !!j.result.isError, json: () => JSON.parse(text) };
  };
  const stop = () => { server.closeAllConnections(); server.close(); };
  return { data, port, post, call, stop };
}

test("mcp: handshake and tool list", async () => {
  const s = await start();
  try {
    const init = await (await s.post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } })).json() as any;
    assert.equal(init.result.protocolVersion, "2025-06-18");
    assert.equal(init.result.serverInfo.name, "open-motion");
    assert.match(init.result.instructions, /facecam/);
    assert.equal((await s.post({ jsonrpc: "2.0", method: "notifications/initialized" })).status, 202);
    const list = await (await s.post({ jsonrpc: "2.0", id: 2, method: "tools/list" })).json() as any;
    const names = list.result.tools.map((t: { name: string }) => t.name);
    for (const t of ["create_project", "import_media", "add_facecam", "transcribe", "job_status", "get_transcript", "apply_patch", "export_video", "spec_reference"]) assert.ok(names.includes(t), t);
    assert.equal((await fetch(`http://127.0.0.1:${s.port}/mcp`)).status, 405);
  } finally { s.stop(); }
});

test("mcp: facecam flow – import, add as facecam, transcript, cut, patch errors explain themselves", async () => {
  const s = await start();
  process.env.OPENMOTION_IMPORT_DIRS = path.join(root, "examples");
  try {
    const p = (await s.call("create_project", { title: "Facecam Test", lang: "de" })).json();
    assert.match(p.editor_url, new RegExp(`/#/p/${p.id}$`));

    const outside = await s.call("import_media", { project: p.id, path: path.join(root, "package.json") });
    assert.ok(outside.error);
    assert.match(outside.text, /File type not supported/);

    const imp = (await s.call("import_media", { project: p.id, path: facecam })).json();
    assert.equal(imp.kind, "video");
    assert.match(imp.path, /^assets\/video\/facecam.*\.mp4$/);

    const fc = (await s.call("add_facecam", { project: p.id, asset: imp.path, layout: "circle" })).json();
    assert.equal(fc.video_layer, "facecam");
    const spec0 = (await s.call("get_spec", { project: p.id })).json();
    const cam = spec0.layers.find((l: any) => l.id === "facecam");
    assert.equal(cam.muted, true);
    assert.equal(cam.radius, 9999);
    assert.equal(spec0.layers.some((l: any) => l.id === fc.audio_layer && l.type === "audio"), !!fc.audio_layer);

    assert.match((await s.call("get_transcript", { project: p.id })).text, /No transcript yet/);

    // A finished transcription job (as the worker would leave it) is saved into the project exactly once.
    const q = new FileQueue(s.data);
    const job = await q.enqueue("transcribe", { projectId: p.id, source: imp.path }, { projectId: p.id });
    await q.update(job.id, { status: "done", result: { source: imp.path, provider: "test:x", language: "de", words: [
      { id: "w1", t0: 0.1, t1: 0.4, text: "Hallo" }, { id: "w2", t0: 0.5, t1: 0.8, text: "äh" }, { id: "w3", t0: 0.9, t1: 1.3, text: "Welt" },
    ] } });
    const st = (await s.call("job_status", { job: job.id })).json();
    assert.equal(st.status, "done");
    assert.equal(st.words, 3);
    const tr = (await s.call("get_transcript", { project: p.id })).text;
    assert.match(tr, /w2@0\.5-0\.8 äh/);
    assert.match(tr, /filler 0\.5-0\.9 äh/);

    const cut = (await s.call("apply_patch", { project: p.id, ops: [{ op: "cut", t0: 0.5, t1: 0.8, reason: "filler" }] })).json();
    assert.ok(cut.ok);
    assert.doesNotMatch((await s.call("get_transcript", { project: p.id })).text, /w2@/);
    await s.call("job_status", { job: job.id });
    assert.equal((await s.call("get_spec", { project: p.id })).json().transcript.cuts.length, 1, "job_status must not overwrite the transcript (and its cuts) again");

    const bad = await s.call("apply_patch", { project: p.id, ops: [{ op: "set", id: "nope", path: "text", value: "x" }] });
    assert.ok(bad.error);
    assert.match(bad.text, /no layer with id "nope"/);

    const ok = (await s.call("apply_patch", { project: p.id, ops: [{ op: "add", layer: { id: "titel", type: "text", track: 5, start: 0, duration: 2, anchor: { word: "w3", offset: -0.2 }, frame: { x: 100, y: 100, w: 800, h: 120 }, text: "Welt", style: { fontSize: 80 } } }] })).json();
    assert.deepEqual(ok.changed, ["titel"]);
    assert.match((await s.call("get_project", { project: p.id })).text, /titel/);
    assert.match((await s.call("spec_reference", { project: p.id })).text, /"op":"cut"/);
  } finally {
    delete process.env.OPENMOTION_IMPORT_DIRS;
    s.stop();
  }
});

test("mcp: import only from allowed folders", async () => {
  const s = await start();
  process.env.OPENMOTION_IMPORT_DIRS = path.join(os.tmpdir(), "om-nothing-here");
  try {
    const p = (await s.call("create_project", { title: "X" })).json();
    const r = await s.call("import_media", { project: p.id, path: facecam });
    assert.ok(r.error);
    assert.match(r.text, /Import only from/);
  } finally {
    delete process.env.OPENMOTION_IMPORT_DIRS;
    s.stop();
  }
});

test("mcp: without password only localhost; with password only with token", async () => {
  const s = await start();
  try {
    // fetch() does not let us fake the Host header (DNS rebinding), so use a raw request.
    const status = await new Promise<number>((resolve, reject) => {
      const rq = http.request({ host: "127.0.0.1", port: s.port, path: "/mcp", method: "POST", headers: { host: "evil.example", "content-type": "application/json" } }, (res) => { res.resume(); resolve(res.statusCode!); });
      rq.on("error", reject);
      rq.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }));
    });
    assert.equal(status, 403);
    assert.equal((await s.post({ jsonrpc: "2.0", id: 1, method: "ping" }, { origin: "https://evil.example" })).status, 403);
    const plain = await fetch(`http://127.0.0.1:${s.port}/mcp`, { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" });
    assert.equal(plain.status, 415);
  } finally { s.stop(); }

  process.env.OPENMOTION_PASSWORD = "test-passwort-123456";
  const t = await start();
  try {
    const token = (await new Auth(t.data).createToken("mcp")).token;
    assert.equal((await t.post({ jsonrpc: "2.0", id: 1, method: "ping" })).status, 401);
    assert.equal((await t.post({ jsonrpc: "2.0", id: 1, method: "ping" }, { authorization: "Bearer falsch" })).status, 401);
    const ok = await t.post({ jsonrpc: "2.0", id: 1, method: "ping" }, { authorization: `Bearer ${token}`, origin: "https://motion.example.com" });
    assert.equal(ok.status, 200);
  } finally {
    delete process.env.OPENMOTION_PASSWORD;
    t.stop();
  }
});

test("rev: changes through MCP bump the revision the editor polls", async () => {
  const s = await start();
  try {
    const p = (await s.call("create_project", { title: "Rev" })).json();
    const rev = async () => ((await (await fetch(`http://127.0.0.1:${s.port}/api/projects/${p.id}/rev`)).json()) as { updatedAt: string }).updatedAt;
    const before = await rev();
    await new Promise((r) => setTimeout(r, 5));
    await s.call("apply_patch", { project: p.id, ops: [{ op: "meta", set: { title: "Neu" } }] });
    assert.notEqual(await rev(), before);
  } finally { s.stop(); }
});
