import { test } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { MotionSpec } from "@openmotion/core";
import { completeCli, runAgent, type Settings } from "@openmotion/server";

const root = path.resolve(import.meta.dirname, "../../..");
const example = JSON.parse(readFileSync(path.join(root, "examples/explainer/spec.json"), "utf8")) as MotionSpec;
const answer = { message: "Schloss gedreht.", ops: [{ op: "set", id: "s1-icon", path: "frame.rotation", value: 5 }] };

/** Writes a fake CLI that logs its args, stdin and env to a file and prints a canned answer. */
async function fakeCli(kind: "claude" | "codex", opts: { fail?: string } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "om-cli-test-"));
  const log = path.join(dir, "log.json");
  const bin = path.join(dir, kind);
  const reply = JSON.stringify(answer);
  await writeFile(bin, `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("${kind} 9.9.9"); process.exit(0); }
const stdin = fs.readFileSync(0, "utf8");
fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify({ args, stdin, apiKey: process.env.ANTHROPIC_API_KEY ?? null, cwd: process.cwd() }));
${opts.fail ? `console.error(${JSON.stringify(opts.fail)}); process.exit(1);` : ""}
if (${JSON.stringify(kind)} === "claude") console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "Klar! " + ${JSON.stringify(reply)} }));
else { const i = args.indexOf("--output-last-message"); fs.writeFileSync(args[i + 1], ${JSON.stringify(reply)}); console.log("codex log noise"); }
`);
  await chmod(bin, 0o755);
  return { bin, read: async () => JSON.parse(await readFile(log, "utf8")) as { args: string[]; stdin: string; apiKey: string | null; cwd: string } };
}

const settings = (provider: Settings["ai"]["provider"], model?: string): Settings => ({ transcription: { provider: "local", language: "de", models: {} }, ai: { provider, model }, images: { provider: "kie" }, keys: {} });

test("claude-code: agent runs through the CLI without any key, tools off, API key not passed on", async () => {
  const cli = await fakeCli("claude");
  process.env.OPENMOTION_CLAUDE_BIN = cli.bin;
  process.env.ANTHROPIC_API_KEY = "sk-should-not-leak";
  try {
    const dir = await mkdtemp(path.join(os.tmpdir(), "om-ai-"));
    const r = await runAgent({ kind: "comment", spec: example, comment: { t: 2, layer: "s1-icon", text: "dreh das Schloss" } }, { settings: settings("claude-code", "opus"), projectDir: dir });
    assert.deepEqual(r.changed, ["s1-icon"]);
    const log = await cli.read();
    assert.equal(log.args[0], "-p");
    assert.deepEqual(log.args.slice(log.args.indexOf("--tools"), log.args.indexOf("--tools") + 2), ["--tools", ""]);
    assert.ok(log.args.includes("--strict-mcp-config"));
    assert.match(log.args[log.args.indexOf("--system-prompt") + 1], /motion director of Open Motion/);
    assert.equal(log.args[log.args.indexOf("--model") + 1], "opus");
    assert.match(log.stdin, /AUSGEWÄHLTE EBENE[\s\S]*"id":"s1-icon"/);
    assert.equal(log.apiKey, null);
    assert.notEqual(log.cwd, process.cwd());
  } finally {
    delete process.env.OPENMOTION_CLAUDE_BIN;
    delete process.env.ANTHROPIC_API_KEY;
  }
});

test("codex: prompt via stdin, read-only sandbox, answer from --output-last-message, no model flag when empty", async () => {
  const cli = await fakeCli("codex");
  process.env.OPENMOTION_CODEX_BIN = cli.bin;
  try {
    const text = await completeCli("codex", undefined, "SYSTEM-REGELN", [{ role: "user", content: "Hallo" }, { role: "assistant", content: "Hi" }, { role: "user", content: "Mach es rot" }]);
    assert.deepEqual(JSON.parse(text), answer);
    const log = await cli.read();
    assert.equal(log.args[0], "exec");
    assert.equal(log.args.at(-1), "-");
    assert.equal(log.args[log.args.indexOf("--sandbox") + 1], "read-only");
    assert.ok(!log.args.includes("--model"));
    assert.match(log.stdin, /^SYSTEM-REGELN[\s\S]*BISHERIGES GESPRÄCH[\s\S]*\[Du\]\nHi[\s\S]*NEUE NACHRICHT\nMach es rot$/);
  } finally {
    delete process.env.OPENMOTION_CODEX_BIN;
  }
});

test("claude-code: expired login shows only the readable message plus what to do", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "om-cli-test-"));
  const bin = path.join(dir, "claude");
  await writeFile(bin, `#!/usr/bin/env node
require("node:fs").readFileSync(0);
console.log(JSON.stringify({ type: "result", is_error: true, subagent_stats: { spawned: 0 }, result: "Failed to authenticate: OAuth session expired and could not be refreshed" }));
process.exit(1);
`);
  await chmod(bin, 0o755);
  process.env.OPENMOTION_CLAUDE_BIN = bin;
  try {
    await assert.rejects(completeCli("claude-code", undefined, "s", [{ role: "user", content: "x" }]), (e: Error) => {
      assert.equal(e.message, "Claude Code (Abo) beendet mit Code 1: Failed to authenticate: OAuth session expired and could not be refreshed → Einmal `claude` im Terminal starten und mit /login anmelden.");
      return true;
    });
  } finally {
    delete process.env.OPENMOTION_CLAUDE_BIN;
  }
});

test("CLI errors say what to do: missing program, not logged in", async () => {
  process.env.OPENMOTION_CLAUDE_BIN = path.join(os.tmpdir(), "does-not-exist-claude");
  try {
    await assert.rejects(completeCli("claude-code", undefined, "s", [{ role: "user", content: "x" }]), /nicht gefunden\. Installieren: npm install -g @anthropic-ai\/claude-code[\s\S]*ohne Docker/);
  } finally {
    delete process.env.OPENMOTION_CLAUDE_BIN;
  }
  const cli = await fakeCli("codex", { fail: "Error: not logged in" });
  process.env.OPENMOTION_CODEX_BIN = cli.bin;
  try {
    await assert.rejects(completeCli("codex", undefined, "s", [{ role: "user", content: "x" }]), /Codex \(Abo\) beendet mit Code 1: Error: not logged in → Einmal `codex login`/);
  } finally {
    delete process.env.OPENMOTION_CODEX_BIN;
  }
});

test("liveSummary: shows the half-written answer and counts the changes built so far", async () => {
  const { liveSummary } = await import("../src/ai/cli.ts");
  assert.deepEqual(liveSummary('{"message": "Dein Video hat jetzt \\"drei\\" Sze'), { phase: "writing", text: 'Dein Video hat jetzt "drei" Sze', ops: undefined });
  assert.deepEqual(liveSummary('{"message": "Fertig.", "ops": [{"op":"add","layer":{}},{"op": "set"'), { phase: "writing", text: "Fertig.", ops: 2 });
  assert.deepEqual(liveSummary(""), { phase: "writing", text: "", ops: undefined });
});
