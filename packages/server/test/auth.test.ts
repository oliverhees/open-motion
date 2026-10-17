import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer, FileQueue } from "@openmotion/server";

const root = path.resolve(import.meta.dirname, "../../..");

async function start(password?: string) {
  const data = await mkdtemp(path.join(os.tmpdir(), "om-auth-"));
  if (password) process.env.OPENMOTION_PASSWORD = password;
  const server = createServer({ dataDir: data, examplesDir: path.join(root, "examples/explainer") });
  delete process.env.OPENMOTION_PASSWORD;
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  const api = (p: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:${port}${p}`, init);
  return { data, api, stop: () => { server.closeAllConnections(); server.close(); } };
}

test("password: locked until login, cookie session, CSRF header for changes", async () => {
  const { data, api, stop } = await start("geheim-123");
  assert.equal((await api("/api/health")).status, 200, "health stays public");
  assert.equal((await api("/api/projects")).status, 401);
  assert.equal((await api("/projects/x/assets/a.png")).status, 401, "project files are protected too");
  assert.deepEqual(await (await api("/api/auth/me")).json(), { required: true, authenticated: false, via: null });
  assert.equal((await api("/api/auth/login", { method: "POST", body: JSON.stringify({ password: "falsch" }) })).status, 401);
  const ok = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ password: "geheim-123" }) });
  assert.equal(ok.status, 200);
  const setCookie = ok.headers.get("set-cookie")!;
  assert.match(setCookie, /om_session=[0-9a-f]{64}; Path=\/; HttpOnly; SameSite=Lax/);
  const cookie = setCookie.split(";")[0];
  assert.equal((await api("/api/projects", { headers: { cookie } })).status, 200);
  assert.equal((await api("/api/projects", { method: "POST", headers: { cookie }, body: JSON.stringify({ title: "x" }) })).status, 403, "no x-om header → blocked");
  assert.equal((await api("/api/projects", { method: "POST", headers: { cookie, "x-om": "1" }, body: JSON.stringify({ title: "x" }) })).status, 201);
  assert.equal(((await stat(path.join(data, "sessions.json"))).mode & 0o777), 0o600);
  await api("/api/auth/logout", { method: "POST", headers: { cookie } });
  assert.equal((await api("/api/projects", { headers: { cookie } })).status, 401, "logout kills the session");
  stop();
});

test("API tokens for AIs: shown once, hashed, usable as Bearer, revocable, cannot mint tokens", async () => {
  const { data, api, stop } = await start("pw");
  const cookie = (await api("/api/auth/login", { method: "POST", body: JSON.stringify({ password: "pw" }) })).headers.get("set-cookie")!.split(";")[0];
  const created = (await (await api("/api/tokens", { method: "POST", headers: { cookie, "x-om": "1" }, body: JSON.stringify({ name: "Claude" }) })).json()) as { token: string; info: { id: string; prefix: string } };
  assert.match(created.token, /^om_[A-Za-z0-9_-]{32}$/);
  const auth = { authorization: `Bearer ${created.token}` };
  assert.equal((await api("/api/projects", { headers: auth })).status, 200);
  assert.equal((await api("/api/projects", { method: "POST", headers: auth, body: JSON.stringify({ title: "per KI" }) })).status, 201, "tokens need no CSRF header");
  assert.equal((await api("/api/tokens", { headers: auth })).status, 403);
  const list = (await (await api("/api/tokens", { headers: { cookie } })).json()) as { name: string; lastUsed?: string }[];
  assert.equal(list[0].name, "Claude");
  assert.ok(list[0].lastUsed);
  const { readFile } = await import("node:fs/promises");
  assert.doesNotMatch(await readFile(path.join(data, "tokens.json"), "utf8"), new RegExp(created.token.slice(3)));
  await api(`/api/tokens/${created.info.id}`, { method: "DELETE", headers: { cookie, "x-om": "1" } });
  assert.equal((await api("/api/projects", { headers: auth })).status, 401);
  stop();
});

test("brute force brake: 10 wrong passwords → locked", async () => {
  const { api, stop } = await start("richtig");
  for (let i = 0; i < 10; i++) await api("/api/auth/login", { method: "POST", body: JSON.stringify({ password: `nope${i}` }) });
  const r = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ password: "richtig" }) });
  assert.equal(r.status, 429);
  stop();
});

test("queue: one job, two workers → exactly one gets it; stale jobs return", async () => {
  const data = await mkdtemp(path.join(os.tmpdir(), "om-q-"));
  const a = new FileQueue(data);
  const b = new FileQueue(data);
  const job = await a.enqueue("export", { x: 1 });
  const [ra, rb] = await Promise.all([a.claim(["export"], "A"), b.claim(["export"], "B")]);
  assert.equal([ra, rb].filter(Boolean).length, 1);
  assert.equal((await a.get(job.id))!.status, "running");
  await a.update(job.id, { startedAt: Date.now() - 7 * 3600_000 });
  await a.requeueStale();
  assert.equal((await a.get(job.id))!.status, "queued");
  assert.ok(await b.claim(["export"], "B"), "requeued job can be claimed again");
  assert.equal(await a.claim(["transcribe"], "A"), undefined);
});

test("no password configured: open (local use)", async () => {
  const { api, stop } = await start();
  assert.deepEqual(await (await api("/api/auth/me")).json(), { required: false, authenticated: true, via: "open" });
  assert.equal((await api("/api/projects")).status, 200);
  stop();
});
