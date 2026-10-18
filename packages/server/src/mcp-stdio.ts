#!/usr/bin/env node
// stdio bridge for MCP clients that cannot speak HTTP: forwards every JSON-RPC line to POST /mcp
// of a running Open Motion server and prints the answer.
//   OPENMOTION_URL=http://localhost:4317  OPENMOTION_TOKEN=<API token, optional without password>
//   node packages/server/src/mcp-stdio.ts
import readline from "node:readline";

const base = (process.env.OPENMOTION_URL ?? "http://localhost:4317").replace(/\/+$/, "");
const token = process.env.OPENMOTION_TOKEN;
const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream" };
if (token) headers.authorization = `Bearer ${token}`;

const write = (o: unknown) => process.stdout.write(`${JSON.stringify(o)}\n`);

readline.createInterface({ input: process.stdin }).on("line", async (line) => {
  if (!line.trim()) return;
  let msg: { id?: unknown };
  try { msg = JSON.parse(line); } catch { return write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); }
  try {
    const r = await fetch(`${base}/mcp`, { method: "POST", headers, body: line });
    const text = await r.text();
    if (r.status === 202 || !text) return;
    const j = JSON.parse(text);
    if (j.jsonrpc) return write(j);
    if (Array.isArray(j)) return j.forEach(write);
    if (msg.id !== undefined) write({ jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: `Open Motion (${r.status}): ${j.error ?? text.slice(0, 300)}` } });
  } catch (e) {
    if (msg.id !== undefined) write({ jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: `Open Motion not reachable at ${base}: ${(e as Error).message}. Start it with npm start.` } });
  }
});
