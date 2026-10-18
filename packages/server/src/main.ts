#!/usr/bin/env node
// Start: node packages/server/src/main.ts
//   OPENMOTION_ROLE = all (default: editor + worker in one process) | app | worker
//   PORT=4317  OPENMOTION_HOST=127.0.0.1  OPENMOTION_DATA=./data  OPENMOTION_PASSWORD=…  OPENMOTION_REQUIRE_AUTH=1 (Docker)
import path from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "./server.ts";
import { runWorker } from "./worker.ts";
import { mcpRoute } from "./mcp.ts";

const root = path.resolve(import.meta.dirname, "../../..");
const port = Number(process.env.PORT ?? 4317);
const dataDir = path.resolve(process.env.OPENMOTION_DATA ?? path.join(root, "data"));
process.env.OPENMOTION_LOG_DIR ??= path.join(dataDir, "logs");
const role = (process.env.OPENMOTION_ROLE ?? "all") as "all" | "app" | "worker";

if (role !== "worker" && process.env.OPENMOTION_REQUIRE_AUTH === "1" && !process.env.OPENMOTION_PASSWORD) {
  console.error("✗ OPENMOTION_PASSWORD fehlt. Ohne Passwort wäre der Editor offen im Internet. Bitte setzen und neu starten.");
  process.exit(1);
}

if (role !== "worker") {
  const server = createServer({ dataDir, examplesDir: path.join(root, "examples/explainer"), editorDist: path.join(root, "packages/editor/dist"), extra: mcpRoute() });
  // OPENMOTION_HOST=127.0.0.1 (set by the installer): reachable only from this computer, not from the network.
  server.listen(port, process.env.OPENMOTION_HOST || undefined, () => {
    console.log(`OpenMotion (${role}) läuft auf http://localhost:${port}`);
    console.log(`Daten: ${dataDir}`);
    console.log(`MCP für Claude Code, Codex, Hermes: http://localhost:${port}/mcp`);
    if (!process.env.OPENMOTION_PASSWORD) console.log("⚠ Kein Passwort gesetzt (OPENMOTION_PASSWORD): nur lokal so betreiben.");
    if (process.env.OPENMOTION_DEBUG === "1") console.log(`Debug-Log: ${process.env.OPENMOTION_LOG_DIR}`);
    if (process.env.OPENMOTION_FAKE_AI === "1") console.log("⚠ Testmodus: KI-Antworten sind simuliert (OPENMOTION_FAKE_AI=1)");
    if (process.env.OPENMOTION_OPEN_BROWSER === "1") openBrowser(`http://localhost:${port}`);
  });
  server.on("error", (e: NodeJS.ErrnoException) => {
    if (e.code !== "EADDRINUSE") throw e;
    if (process.env.OPENMOTION_OPEN_BROWSER === "1") {
      console.log(`Open Motion läuft schon auf Port ${port}. Öffne den Editor …`);
      openBrowser(`http://localhost:${port}`);
      process.exit(0);
    }
    console.error(`✗ Port ${port} ist belegt. Läuft Open Motion schon? Sonst anderen Port wählen: PORT=4400 npm start`);
    process.exit(1);
  });
  const stop = () => server.close(() => process.exit(0));
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
if (role !== "app") {
  const ac = new AbortController();
  process.on("SIGTERM", () => ac.abort());
  void runWorker(dataDir, ac.signal).then(() => role === "worker" && process.exit(0));
}

/** Opens the editor in the default browser (set by the installer's start command). */
function openBrowser(url: string) {
  const [cmd, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try {
    spawn(cmd, args as string[], { stdio: "ignore", detached: true }).on("error", () => console.log(`Editor öffnen: ${url}`)).unref();
  } catch {
    console.log(`Editor öffnen: ${url}`);
  }
}
