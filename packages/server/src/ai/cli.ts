// Language models through a local CLI with your own subscription (no API key):
//   claude-code  →  claude -p   (Claude Pro/Max login of the Claude Code CLI)
//   codex        →  codex exec  (ChatGPT login of the Codex CLI)
// Only works where the CLI is installed and logged in, so: on your own computer, not in Docker.
// The prompt goes in through stdin, the answer comes back as text. Tools of the CLI are switched off
// or read-only: the CLI only writes the JSON answer, the core checks it like any other answer.

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const CLI_PROVIDERS = ["claude-code", "codex"] as const;
export type CliProvider = (typeof CLI_PROVIDERS)[number];

export const CLI_LABEL: Record<CliProvider, string> = { "claude-code": "Claude Code (Abo)", codex: "Codex (Abo)" };
const BIN: Record<CliProvider, { env: string; name: string; install: string; login: string }> = {
  "claude-code": { env: "OPENMOTION_CLAUDE_BIN", name: "claude", install: "npm install -g @anthropic-ai/claude-code", login: "Einmal `claude` im Terminal starten und mit /login anmelden." },
  codex: { env: "OPENMOTION_CODEX_BIN", name: "codex", install: "npm install -g @openai/codex", login: "Einmal `codex login` im Terminal ausführen." },
};
const TIMEOUT_MS = 10 * 60_000;

export const isCliProvider = (p: string): p is CliProvider => (CLI_PROVIDERS as readonly string[]).includes(p);
export const cliBin = (p: CliProvider) => process.env[BIN[p].env] || BIN[p].name;

export interface CliMsg { role: "user" | "assistant"; content: string }

/** One answer from the CLI. History is flattened into one prompt, because the CLIs run one turn at a time. */
export async function completeCli(provider: CliProvider, model: string | undefined, system: string, messages: CliMsg[]): Promise<string> {
  const prompt = flatten(messages);
  const work = await mkdtemp(path.join(os.tmpdir(), "om-cli-"));
  try {
    if (provider === "claude-code") {
      const args = ["-p", "--output-format", "json", "--tools", "", "--strict-mcp-config", "--no-session-persistence", "--system-prompt", system];
      if (model) args.push("--model", model);
      // Without this the CLI would bill an API key from the environment instead of the subscription.
      const env = { ...process.env };
      delete env.ANTHROPIC_API_KEY;
      const out = await runCli(provider, args, prompt, work, env);
      return parseClaude(out);
    }
    const last = path.join(work, "answer.txt");
    const args = ["exec", "--skip-git-repo-check", "--sandbox", "read-only", "--color", "never", "--output-last-message", last];
    if (model) args.push("--model", model);
    args.push("-");
    const out = await runCli(provider, args, `${system}\n\n${prompt}`, work, process.env);
    return (await readFile(last, "utf8").catch(() => out)).trim();
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** Is the CLI installed? Returns its version line, or throws an error that says how to install it. */
export async function cliVersion(provider: CliProvider): Promise<string> {
  const out = await runCli(provider, ["--version"], "", os.tmpdir(), process.env, 30_000);
  return out.trim().split("\n")[0].slice(0, 80);
}

function flatten(messages: CliMsg[]): string {
  if (messages.length === 1) return messages[0].content;
  const before = messages.slice(0, -1).map((m) => `[${m.role === "user" ? "Nutzer" : "Du"}]\n${m.content}`).join("\n\n");
  return `BISHERIGES GESPRÄCH\n${before}\n\nNEUE NACHRICHT\n${messages[messages.length - 1].content}`;
}

function parseClaude(out: string): string {
  let j: { result?: unknown; is_error?: boolean; subtype?: string };
  try {
    j = JSON.parse(out.trim().split("\n").filter(Boolean).pop() ?? "{}");
  } catch {
    return out;
  }
  if (j.is_error) throw new Error(`Claude Code meldet einen Fehler (${j.subtype ?? "unbekannt"}): ${String(j.result ?? "").slice(0, 400)}${loginHint("claude-code", String(j.result ?? ""))}`);
  return typeof j.result === "string" ? j.result : out;
}

function loginHint(p: CliProvider, text: string): string {
  return /login|log in|logged|auth|credential|api key|unauthori|401/i.test(text) ? ` → ${BIN[p].login}` : "";
}

function runCli(p: CliProvider, args: string[], stdin: string, cwd: string, env: NodeJS.ProcessEnv, timeout = TIMEOUT_MS): Promise<string> {
  const bin = cliBin(p);
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error(`${CLI_LABEL[p]}: keine Antwort nach ${Math.round(timeout / 60_000)} Minuten. Abgebrochen.`)); }, timeout);
    child.stdout.on("data", (c: Buffer) => { out += c; });
    child.stderr.on("data", (c: Buffer) => { err += c; });
    child.on("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (e.code === "ENOENT") reject(new Error(`${CLI_LABEL[p]}: Programm „${bin}" nicht gefunden. Installieren: ${BIN[p].install}. ${BIN[p].login} Läuft Open Motion in Docker, ist die CLI dort nicht vorhanden: dann ohne Docker starten (npm start).`));
      else reject(new Error(`${CLI_LABEL[p]}: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve(out);
      // Claude Code prints its error as JSON on stdout: show only the readable part.
      let msg = (err.trim() || out.trim()).slice(-600);
      try {
        const j = JSON.parse(out.trim().split("\n").filter(Boolean).pop() ?? "") as { result?: unknown };
        if (typeof j.result === "string" && j.result) msg = j.result.slice(0, 400);
      } catch { /* not JSON */ }
      reject(new Error(`${CLI_LABEL[p]} beendet mit Code ${code}: ${msg}${loginHint(p, msg)}`));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(stdin);
  });
}
