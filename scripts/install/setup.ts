#!/usr/bin/env node
// Second half of the installer (install.sh / install.ps1 bring Node and the app, then run this).
// Same steps on Linux, macOS and Windows, everything inside one folder (no admin rights):
//   <home>/node      Node.js        <home>/app     Open Motion       <home>/bin    ffmpeg, ffprobe
//   <home>/venv      Python + faster-whisper (optional)               <home>/data   your projects
// Then: start command + shortcut, Claude Code / Codex / Hermes connected via MCP.
//
//   node scripts/install/setup.ts --home <dir>     OM_WHISPER=1|0 answers the Whisper question

import { spawn, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { pathToFileURL } from "node:url";

const FFMPEG_STATIC = "5.3.0";
const FFPROBE_STATIC = "3.1.0";
const UV = "0.12.21";
const PYTHON = "3.12";
const FASTER_WHISPER = "1.1.1";
// faster-whisper 1.1.1 imports requests, newer huggingface_hub no longer brings it along.
const REQUESTS = "2.34.2";
const PORT = 4317;
// Own config folders of Claude Code / Codex: the start icon does not load your shell profile, so keep them.
const KEEP_ENV = ["CLAUDE_CONFIG_DIR", "CODEX_HOME"].filter((k) => process.env[k]);

const win = process.platform === "win32";
const mac = process.platform === "darwin";
const de = /^de/i.test(process.env.LANG ?? process.env.LC_ALL ?? Intl.DateTimeFormat().resolvedOptions().locale ?? "");
const t = (deText: string, enText: string) => (de ? deText : enText);

const argHome = process.argv.indexOf("--home");
const HOME = path.resolve(argHome > 0 ? process.argv[argHome + 1] : path.join(os.homedir(), ".openmotion"));
const APP = path.join(HOME, "app");
const NODE = process.execPath;
const BIN = path.join(HOME, "bin");
const DATA = path.join(HOME, "data");
const VENV = path.join(HOME, "venv");
const VENV_PY = win ? path.join(VENV, "Scripts", "python.exe") : path.join(VENV, "bin", "python");
const NPM_CLI = [path.join(path.dirname(NODE), "node_modules", "npm", "bin", "npm-cli.js"), path.join(path.dirname(NODE), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js")].find(existsSync);
const ENV = { ...process.env, PATH: [path.dirname(NODE), BIN, process.env.PATH ?? ""].join(path.delimiter), npm_config_update_notifier: "false", npm_config_fund: "false", npm_config_audit: "false" };

const step = (n: number, text: string) => console.log(`\n\x1b[1m[${n}/7] ${text}\x1b[0m`);
const ok = (text: string) => console.log(`  ✅ ${text}`);
const warn = (text: string) => console.log(`  ⚠️  ${text}`);

function sh(cmd: string, args: string[], opts: { cwd?: string; quiet?: boolean; env?: NodeJS.ProcessEnv } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd ?? APP, env: opts.env ?? ENV, stdio: opts.quiet ? ["ignore", "pipe", "pipe"] : ["ignore", "inherit", "inherit"] });
    let err = "";
    child.stderr?.on("data", (c: Buffer) => { err += c; });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} ${args.slice(0, 3).join(" ")} → Code ${code}${err ? `\n${err.trim().slice(-800)}` : ""}`))));
  });
}
const npm = (args: string[], cwd = APP, quiet = false) => {
  if (!NPM_CLI) throw new Error(t("npm wurde neben Node nicht gefunden.", "npm was not found next to Node."));
  return sh(NODE, [NPM_CLI, ...args], { cwd, quiet });
};

/** Finds a program on PATH (Windows: also .cmd/.exe). */
function which(name: string): string | null {
  const exts = win ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").map((e) => e.toLowerCase()) : [""];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    for (const ext of exts) {
      const p = path.join(dir, name + ext);
      if (dir && existsSync(p)) return p;
    }
  }
  return null;
}

async function ask(question: string, def: boolean): Promise<boolean> {
  const env = process.env.OM_WHISPER;
  if (env === "1" || env === "0") return env === "1";
  if (!process.stdin.isTTY) return def;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((r) => rl.question(`  ${question} ${def ? "[J/n]" : "[j/N]"} `.replace("[J/n]", t("[J/n]", "[Y/n]")).replace("[j/N]", t("[j/N]", "[y/N]")), r));
  rl.close();
  return answer.trim() === "" ? def : /^[jy]/i.test(answer.trim());
}

function link(target: string, at: string) {
  rmSync(at, { force: true });
  if (win) copyFileSync(target, at);
  else symlinkSync(target, at);
}

// ---------- 1. App ----------
async function app() {
  step(1, t("Open Motion einrichten (npm-Pakete, Editor)", "Setting up Open Motion (npm packages, editor)"));
  await npm(["ci", "--no-audit", "--no-fund", "--loglevel=error"]);
  await npm(["run", "editor:build", "--silent"], APP, true);
  ok(t("Editor gebaut", "Editor built"));
}

// ---------- 2. Browser for the export ----------
async function browser() {
  step(2, t("Chrome für den Video-Export", "Chrome for the video export"));
  await npm(["exec", "--yes", "--", "hyperframes", "browser", "ensure"]);
  ok(t("Chrome bereit", "Chrome ready"));
}

// ---------- 3. FFmpeg ----------
async function ffmpeg() {
  step(3, "FFmpeg");
  const tools = path.join(HOME, "tools");
  mkdirSync(tools, { recursive: true });
  writeFileSync(path.join(tools, "package.json"), JSON.stringify({ name: "openmotion-tools", private: true }));
  await npm(["install", "--no-audit", "--no-fund", "--loglevel=error", "--save-exact", `ffmpeg-static@${FFMPEG_STATIC}`, `ffprobe-static@${FFPROBE_STATIC}`], tools);
  mkdirSync(BIN, { recursive: true });
  const exe = win ? ".exe" : "";
  const ff = path.join(tools, "node_modules", "ffmpeg-static", `ffmpeg${exe}`);
  const fp = path.join(tools, "node_modules", "ffprobe-static", "bin", process.platform, process.arch, `ffprobe${exe}`);
  if (!existsSync(ff)) throw new Error(t(`FFmpeg für ${process.platform}/${process.arch} nicht verfügbar. Bitte FFmpeg über den Paketmanager installieren und den Installer erneut starten.`, `FFmpeg for ${process.platform}/${process.arch} is not available. Please install FFmpeg with your package manager and run the installer again.`));
  link(ff, path.join(BIN, `ffmpeg${exe}`));
  if (existsSync(fp)) link(fp, path.join(BIN, `ffprobe${exe}`));
  else if (which("ffprobe")) warn(t("Eigenes ffprobe fehlt für dieses System, nutze das vorhandene.", "No bundled ffprobe for this system, using the installed one."));
  else throw new Error(t("ffprobe fehlt für dieses System. Bitte FFmpeg über den Paketmanager installieren (z. B. sudo apt install ffmpeg) und den Installer erneut starten.", "ffprobe is missing for this system. Please install FFmpeg with your package manager (e.g. sudo apt install ffmpeg) and run the installer again."));
  if (!win) for (const f of [ff, fp]) if (existsSync(f)) chmodSync(f, 0o755);
  ok(t("FFmpeg bereit", "FFmpeg ready"));
}

// ---------- 4. Whisper (optional) ----------
async function whisper(): Promise<boolean> {
  step(4, t("Lokales Whisper (Transkript kostenlos, offline)", "Local Whisper (free offline transcripts)"));
  if (existsSync(VENV_PY) && spawnSync(VENV_PY, ["-c", "import faster_whisper"]).status === 0) {
    ok(t("schon installiert", "already installed"));
    return true;
  }
  console.log(t("  Ohne Whisper geht das Transkript nur mit API-Key. Download ca. 1 GB.", "  Without Whisper, transcripts need an API key. Download about 1 GB."));
  if (!(await ask(t("Whisper installieren?", "Install Whisper?"), true))) {
    warn(t("übersprungen (später: Installer erneut starten)", "skipped (later: run the installer again)"));
    return false;
  }
  const uvDir = path.join(HOME, "uv");
  const target = { "linux-x64": "x86_64-unknown-linux-gnu", "linux-arm64": "aarch64-unknown-linux-gnu", "darwin-x64": "x86_64-apple-darwin", "darwin-arm64": "aarch64-apple-darwin", "win32-x64": "x86_64-pc-windows-msvc", "win32-arm64": "aarch64-pc-windows-msvc" }[`${process.platform}-${process.arch}`];
  if (!target) throw new Error(`Whisper: ${process.platform}/${process.arch} ${t("wird nicht unterstützt", "is not supported")}`);
  const file = `uv-${target}.${win ? "zip" : "tar.gz"}`;
  const uv = path.join(uvDir, win ? "uv.exe" : "uv");
  if (!existsSync(uv)) {
    mkdirSync(uvDir, { recursive: true });
    const archive = path.join(uvDir, file);
    const res = await fetch(`https://github.com/astral-sh/uv/releases/download/${UV}/${file}`);
    if (!res.ok) throw new Error(`uv download: HTTP ${res.status}`);
    writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
    await sh("tar", ["-xf", archive, ...(win ? [] : ["--strip-components=1"]), "-C", uvDir], { cwd: uvDir });
    rmSync(archive, { force: true });
  }
  const uvEnv = { ...ENV, UV_PYTHON_INSTALL_DIR: path.join(HOME, "python"), UV_CACHE_DIR: path.join(HOME, "cache", "uv"), UV_NO_MODIFY_PATH: "1", UV_PYTHON_PREFERENCE: "only-managed" };
  await sh(uv, ["venv", "--quiet", "--allow-existing", "--python", PYTHON, VENV], { env: uvEnv, cwd: HOME });
  await sh(uv, ["pip", "install", "--quiet", "--python", VENV_PY, `faster-whisper==${FASTER_WHISPER}`, `requests==${REQUESTS}`], { env: uvEnv, cwd: HOME });
  const test = spawnSync(VENV_PY, ["-c", "import faster_whisper"], { encoding: "utf8" });
  if (test.status !== 0) throw new Error(`Whisper: ${t("Installation unvollständig", "installation incomplete")}\n${(test.stderr ?? "").trim().slice(-600)}`);
  rmSync(path.join(HOME, "cache"), { recursive: true, force: true });
  ok(t("Whisper bereit (das Sprachmodell lädt beim ersten Transkript)", "Whisper ready (the speech model downloads on the first transcript)"));
  return true;
}

// ---------- 5. Start command + shortcut ----------
function launcher(withWhisper: boolean): string {
  step(5, t("Start-Befehl und Verknüpfung", "Start command and shortcut"));
  mkdirSync(DATA, { recursive: true });
  const main = path.join(APP, "packages", "server", "src", "main.ts");
  let start: string;
  if (win) {
    start = path.join(HOME, "openmotion.cmd");
    writeFileSync(start, [
      "@echo off",
      "title Open Motion",
      `set "PATH=${BIN};${path.dirname(NODE)};%PATH%"`,
      `set "OPENMOTION_DATA=${DATA}"`,
      withWhisper ? `set "OPENMOTION_PYTHON=${VENV_PY}"` : "",
      "set OPENMOTION_OPEN_BROWSER=1",
      "set OPENMOTION_HOST=127.0.0.1",
      ...KEEP_ENV.map((k) => `set "${k}=${process.env[k]}"`),
      `"${NODE}" "${main}"`,
      "if errorlevel 1 pause",
      "",
    ].filter((l, i, a) => l !== "" || i === a.length - 1).join("\r\n"));
    const ps = (lnk: string) => `$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${lnk.replace(/'/g, "''")}');$s.TargetPath='${start.replace(/'/g, "''")}';$s.WorkingDirectory='${HOME.replace(/'/g, "''")}';$s.Description='Open Motion';$s.Save()`;
    const desktop = spawnSync("powershell", ["-NoProfile", "-Command", "[Environment]::GetFolderPath('Desktop')"], { encoding: "utf8" }).stdout?.trim() || path.join(os.homedir(), "Desktop");
    const menu = path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "Microsoft", "Windows", "Start Menu", "Programs");
    for (const lnk of [path.join(desktop, "Open Motion.lnk"), path.join(menu, "Open Motion.lnk")]) {
      const r = spawnSync("powershell", ["-NoProfile", "-Command", ps(lnk)], { stdio: "ignore" });
      if (r.status !== 0) warn(t(`Verknüpfung nicht erstellt: ${lnk}`, `Shortcut not created: ${lnk}`));
    }
    ok(t("Symbol „Open Motion“ auf dem Desktop und im Startmenü", "\"Open Motion\" icon on the desktop and in the Start menu"));
    return start;
  }
  start = path.join(HOME, "openmotion");
  writeFileSync(start, [
    "#!/usr/bin/env bash",
    "# Open Motion starten. Strg+C beendet. / Start Open Motion. Ctrl+C stops it.",
    `export PATH="${BIN}:${path.dirname(NODE)}:$PATH"`,
    `export OPENMOTION_DATA="${DATA}"`,
    withWhisper ? `export OPENMOTION_PYTHON="${VENV_PY}"` : "",
    "export OPENMOTION_OPEN_BROWSER=1",
    "export OPENMOTION_HOST=127.0.0.1",
    ...KEEP_ENV.map((k) => `export ${k}="${process.env[k]}"`),
    `exec "${NODE}" "${main}" "$@"`,
    "",
  ].filter((l, i, a) => l !== "" || i === a.length - 1).join("\n"));
  chmodSync(start, 0o755);
  const localBin = path.join(os.homedir(), ".local", "bin");
  try {
    mkdirSync(localBin, { recursive: true });
    const at = path.join(localBin, "openmotion");
    if (existsSync(at)) unlinkSync(at);
    symlinkSync(start, at);
  } catch { /* optional */ }
  if (mac) {
    const cmd = path.join(os.homedir(), "Desktop", "Open Motion.command");
    try {
      writeFileSync(cmd, `#!/usr/bin/env bash\nexec "${start}"\n`);
      chmodSync(cmd, 0o755);
      ok(t("„Open Motion.command“ auf dem Schreibtisch (Doppelklick startet)", "\"Open Motion.command\" on the desktop (double-click starts it)"));
    } catch { warn(t("Schreibtisch-Symbol nicht erstellt", "Desktop icon not created")); }
  } else {
    const apps = path.join(os.homedir(), ".local", "share", "applications");
    try {
      mkdirSync(apps, { recursive: true });
      const icon = path.join(APP, "packages", "editor", "public", "favicon.svg");
      writeFileSync(path.join(apps, "openmotion.desktop"), [
        "[Desktop Entry]", "Type=Application", "Name=Open Motion", "Comment=Motion graphics as code", `Exec="${start}"`, "Terminal=true", "Categories=AudioVideo;Video;",
        ...(existsSync(icon) ? [`Icon=${icon}`] : []), "",
      ].join("\n"));
      ok(t("„Open Motion“ im Anwendungsmenü", "\"Open Motion\" in the applications menu"));
    } catch { warn(t("Menüeintrag nicht erstellt", "Menu entry not created")); }
  }
  ok(t(`Start im Terminal: openmotion  (oder ${start})`, `Start in a terminal: openmotion  (or ${start})`));
  return start;
}

// ---------- 6. Connect Claude Code, Codex, Hermes ----------
async function connect(): Promise<string[]> {
  step(6, t("KI-Tools verbinden (MCP)", "Connecting AI tools (MCP)"));
  const url = `http://127.0.0.1:${PORT}/mcp`;
  const bridge = path.join(APP, "packages", "server", "src", "mcp-stdio.ts");
  const found: string[] = [];

  const claude = which("claude");
  if (claude) {
    // Windows: claude is a .cmd, which needs a shell; quote the path (user names with spaces).
    const run = (args: string[]) => spawnSync(win ? `"${claude}"` : claude, args, { encoding: "utf8", shell: win, env: ENV });
    run(["mcp", "remove", "--scope", "user", "openmotion"]);
    const r = run(["mcp", "add", "--scope", "user", "--transport", "http", "openmotion", url]);
    if (r.status === 0) { ok("Claude Code"); found.push("claude-code"); } else warn(`Claude Code: ${(r.stderr || r.stdout || "").trim().slice(0, 200)}`);
  }

  const codexDir = path.join(os.homedir(), ".codex");
  if (which("codex") || existsSync(codexDir)) {
    const file = path.join(codexDir, "config.toml");
    const cur = existsSync(file) ? readFileSync(file, "utf8") : "";
    if (/^\[mcp_servers\.openmotion\]/m.test(cur)) ok(t("Codex (war schon eingetragen)", "Codex (already set up)"));
    else {
      mkdirSync(codexDir, { recursive: true });
      writeFileSync(file, `${cur}${cur && !cur.endsWith("\n") ? "\n" : ""}\n[mcp_servers.openmotion]\ncommand = '${NODE}'\nargs = ['${bridge}']\nenv = { OPENMOTION_URL = "http://127.0.0.1:${PORT}" }\n`);
      ok("Codex");
    }
    if (which("codex")) found.push("codex");
  }

  const hermesDir = path.join(os.homedir(), ".hermes");
  if (which("hermes") || existsSync(hermesDir)) {
    const file = path.join(hermesDir, "config.yaml");
    const cur = existsSync(file) ? readFileSync(file, "utf8") : "";
    const entry = `  openmotion:\n    command: '${NODE}'\n    args: ['${bridge}']\n    env:\n      OPENMOTION_URL: 'http://127.0.0.1:${PORT}'\n`;
    if (/^\s+openmotion:/m.test(cur)) ok(t("Hermes (war schon eingetragen)", "Hermes (already set up)"));
    else if (/^mcp_servers:\s*$/m.test(cur)) { writeFileSync(file, cur.replace(/^mcp_servers:\s*$/m, (m) => `${m}\n${entry.trimEnd()}`)); ok("Hermes"); }
    else if (/^mcp_servers:/m.test(cur)) warn(t(`Hermes: bitte von Hand in ${file} unter mcp_servers eintragen:\n${entry}`, `Hermes: please add this under mcp_servers in ${file}:\n${entry}`));
    else { mkdirSync(hermesDir, { recursive: true }); writeFileSync(file, `${cur}${cur && !cur.endsWith("\n") ? "\n" : ""}mcp_servers:\n${entry}`); ok("Hermes"); }
  }

  if (!claude && !found.includes("codex") && !existsSync(hermesDir)) console.log(t("  Keine KI-Tools gefunden. Später installieren und den Installer erneut starten.", "  No AI tools found. Install them later and run the installer again."));
  return found;
}

/** Editor AI uses the subscription CLI, unless the user already set up a provider with a key. */
async function defaults(found: string[]) {
  const { SettingsStore } = await import(pathToFileURL(path.join(APP, "packages", "server", "src", "settings.ts")).href);
  const store = new SettingsStore(DATA);
  const s = await store.read();
  const hasKey = !!s.keys[s.ai.provider];
  const cli = found.find((f) => f === "claude-code" || f === "codex");
  if (cli && !hasKey && s.ai.provider !== "codex" && s.ai.provider !== "claude-code") {
    await store.update({ ai: { provider: cli, model: "" } });
    ok(t(`Editor-KI nutzt dein Abo: ${cli === "codex" ? "Codex" : "Claude Code"}`, `Editor AI uses your subscription: ${cli === "codex" ? "Codex" : "Claude Code"}`));
  }
}

// ---------- 7. Check ----------
async function check() {
  step(7, t("Kurzer Selbsttest", "Quick self-test"));
  const r = spawnSync(path.join(BIN, win ? "ffmpeg.exe" : "ffmpeg"), ["-hide_banner", "-encoders"], { encoding: "utf8" });
  if (!/libx264/.test(r.stdout ?? "")) throw new Error(t("FFmpeg startet nicht oder kann kein H.264.", "FFmpeg does not start or lacks H.264."));
  ok("FFmpeg + H.264");
  const m = spawnSync(NODE, ["-e", `import(${JSON.stringify(pathToFileURL(path.join(APP, "packages", "server", "src", "index.ts")).href)}).then(()=>console.log("ok"))`], { encoding: "utf8", cwd: APP, env: ENV });
  if (!/ok/.test(m.stdout ?? "")) throw new Error(`${t("Server lässt sich nicht laden", "Server does not load")}: ${(m.stderr ?? "").slice(-400)}`);
  ok(t("Server lädt", "Server loads"));
}

async function mainSetup() {
  console.log(t(`\n🎬 Open Motion wird eingerichtet in ${HOME}`, `\n🎬 Setting up Open Motion in ${HOME}`));
  await app();
  await browser();
  await ffmpeg();
  const withWhisper = await whisper();
  const start = launcher(withWhisper);
  const found = await connect();
  await defaults(found);
  await check();
  console.log(t(`
✅ Fertig!

  ▶ Starten: ${win ? "Doppelklick auf „Open Motion“ (Desktop oder Startmenü)" : mac ? "Doppelklick auf „Open Motion.command“ auf dem Schreibtisch" : "„Open Motion“ im Anwendungsmenü"}
             oder im Terminal: ${win ? `"${start}"` : "openmotion"}
  🌐 Der Editor öffnet sich im Browser: http://localhost:${PORT}
  🤖 MCP für KI-Tools: http://localhost:${PORT}/mcp${found.length ? "" : " (KI-Tools später installieren, dann Installer erneut starten)"}
  🔄 Update: den Installations-Befehl einfach noch einmal ausführen. Deine Projekte bleiben.
  🗑️  Entfernen: den Ordner ${HOME} löschen.
`, `
✅ Done!

  ▶ Start: ${win ? "double-click \"Open Motion\" (desktop or Start menu)" : mac ? "double-click \"Open Motion.command\" on the desktop" : "\"Open Motion\" in the applications menu"}
           or in a terminal: ${win ? `"${start}"` : "openmotion"}
  🌐 The editor opens in your browser: http://localhost:${PORT}
  🤖 MCP for AI tools: http://localhost:${PORT}/mcp${found.length ? "" : " (install AI tools later, then run the installer again)"}
  🔄 Update: just run the install command again. Your projects stay.
  🗑️  Uninstall: delete the folder ${HOME}.
`));
}

mainSetup().catch((e) => {
  console.error(`\n❌ ${(e as Error).message}\n`);
  console.error(t("Bitte diese Meldung kopieren und als Issue melden: https://github.com/oliverhees/open-motion/issues", "Please copy this message and report it as an issue: https://github.com/oliverhees/open-motion/issues"));
  process.exit(1);
});
