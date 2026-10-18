import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { imagesAvailable, localMcps } from "../src/integrations.ts";

test("integrations: finds MCP servers of Claude Code, Codex and Hermes (names only); image availability follows the key", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "om-home-"));
  await writeFile(path.join(home, ".claude.json"), JSON.stringify({ mcpServers: { "kie-ai": { command: "x", env: { KEY: "secret" } } }, projects: { "/p": { mcpServers: { openmotion: {} } } } }));
  await mkdir(path.join(home, ".codex"));
  await writeFile(path.join(home, ".codex", "config.toml"), '[mcp_servers.openmotion]\ncommand = "node"\n\n[mcp_servers.kie]\nurl = "x"\n');
  await mkdir(path.join(home, ".hermes"));
  await writeFile(path.join(home, ".hermes", "config.yaml"), "model: x\nmcp_servers:\n  openmotion:\n    command: node\n  kieai:\n    url: y\nother: 1\n");
  const prev = process.env.CODEX_HOME; delete process.env.CODEX_HOME;
  const prevC = process.env.CLAUDE_CONFIG_DIR; delete process.env.CLAUDE_CONFIG_DIR;
  try {
    const found = localMcps(home).map((x) => `${x.tool}/${x.name}`).sort();
    assert.deepEqual(found, ["Claude Code/kie-ai", "Claude Code/openmotion", "Codex/kie", "Codex/openmotion", "Hermes/kieai", "Hermes/openmotion"]);
    assert.ok(!JSON.stringify(localMcps(home)).includes("secret"));
  } finally {
    if (prev !== undefined) process.env.CODEX_HOME = prev;
    if (prevC !== undefined) process.env.CLAUDE_CONFIG_DIR = prevC;
  }
  const s = { transcription: { provider: "local", language: "de", models: {} }, ai: { provider: "anthropic" }, images: { provider: "kie" }, keys: {} } as never;
  assert.equal(imagesAvailable(s), false);
  assert.equal(imagesAvailable({ ...(s as object), keys: { kie: "k" } } as never), true);
});
