// What is connected on this computer: MCP servers of Claude Code / Codex / Hermes (e.g. a Kie AI MCP)
// and whether image generation works. Reads config files only, never prints secrets.

import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Settings } from "./settings.ts";
import { httpFetch } from "./http.ts";

export interface McpFinding { tool: "Claude Code" | "Codex" | "Hermes" | "OpenCode"; name: string }

/** MCP server names configured in the local AI tools (names only). */
export function localMcps(home = os.homedir()): McpFinding[] {
  const out: McpFinding[] = [];
  const claudeDir = process.env.CLAUDE_CONFIG_DIR;
  for (const file of [claudeDir ? path.join(claudeDir, ".claude.json") : "", path.join(home, ".claude.json"), path.join(home, ".claude", "settings.json")].filter(Boolean)) {
    try {
      const j = JSON.parse(readFileSync(file, "utf8")) as { mcpServers?: Record<string, unknown>; projects?: Record<string, { mcpServers?: Record<string, unknown> }> };
      const names = new Set([...Object.keys(j.mcpServers ?? {}), ...Object.values(j.projects ?? {}).flatMap((p) => Object.keys(p?.mcpServers ?? {}))]);
      names.forEach((name) => out.push({ tool: "Claude Code", name }));
    } catch { /* not there */ }
  }
  const codex = path.join(process.env.CODEX_HOME ?? path.join(home, ".codex"), "config.toml");
  if (existsSync(codex)) for (const m of readFileSync(codex, "utf8").matchAll(/^\[mcp_servers\.([^\]\s]+)\]/gm)) out.push({ tool: "Codex", name: m[1].replace(/^"|"$/g, "") });
  const hermes = path.join(home, ".hermes", "config.yaml");
  if (existsSync(hermes)) {
    const txt = readFileSync(hermes, "utf8");
    const block = /^mcp_servers:\s*\n((?:[ \t]+.*\n?)*)/m.exec(txt)?.[1] ?? "";
    for (const m of block.matchAll(/^ {2}([\w.-]+):/gm)) out.push({ tool: "Hermes", name: m[1] });
  }
  for (const file of ["opencode.json", "opencode.jsonc"].map((f) => path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, ".config"), "opencode", f))) {
    try {
      // JSONC: drop comments and trailing commas before parsing (names only are read).
      const txt = readFileSync(file, "utf8").replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1");
      const j = JSON.parse(txt) as { mcp?: Record<string, unknown> };
      Object.keys(j.mcp ?? {}).forEach((name) => out.push({ tool: "OpenCode", name }));
    } catch { /* not there */ }
  }
  const seen = new Set<string>();
  return out.filter((x) => { const k = `${x.tool}/${x.name}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** Is image generation usable right now (key for the active image provider)? */
export function imagesAvailable(s: Settings): boolean {
  const p = s.images.provider;
  return !!(p === "kie" ? s.keys.kie : p === "gemini" ? s.keys.gemini : s.keys[p]);
}

/** Kie.ai credit balance (null if no key or not reachable). */
export async function kieCredits(s: Settings, f: typeof fetch = httpFetch): Promise<number | null> {
  if (!s.keys.kie) return null;
  try {
    const r = await f("https://api.kie.ai/api/v1/chat/credit", { headers: { authorization: `Bearer ${s.keys.kie}` }, signal: AbortSignal.timeout(15_000) });
    const j = (await r.json()) as { code?: number; data?: number };
    return j.code === 200 && typeof j.data === "number" ? j.data : null;
  } catch {
    return null;
  }
}
