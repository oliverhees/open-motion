# 🤖 Open Motion with Claude Code, Codex and Hermes

Two ways, both **without an API key**, using your subscription:

| Way | What happens | Use it when |
| --- | --- | --- |
| **A: Subscription in the editor** | The editor's AI chat runs `claude` or `codex` on your computer | You work in the editor |
| **B: MCP** | Claude Code, Codex or Hermes drive Open Motion from outside | You tell the AI in your terminal what to build |

Both run **on your own computer, without Docker**. The CLIs are not available inside Docker.

---

## 🧰 Installation (once)

**Linux and macOS** (Terminal):

```bash
curl -fsSL https://raw.githubusercontent.com/oliverhees/open-motion/main/install.sh | bash
```

**Windows** (PowerShell):

```powershell
powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/oliverhees/open-motion/main/install.ps1 | iex"
```

The installer does everything on its own, without admin rights:

- 📦 Node, FFmpeg and Open Motion in **one** folder (`~/.openmotion`, Windows: `%LOCALAPPDATA%\OpenMotion`)
- 🎙️ asks whether to install **Whisper** (free transcripts, about 1 GB, brings its own Python)
- ▶️ creates a **start icon** (Linux: applications menu, macOS: desktop, Windows: desktop + Start menu) and the `openmotion` command
- 🤖 finds **Claude Code, Codex and Hermes** and connects them via MCP; the editor chat then uses your subscription
- 🔒 Open Motion is then only reachable from your computer, not from the network

**Important:** install Claude Code, Codex or Hermes first and log in once (`claude` → `/login`, `codex login`). Added them later? Just run the installer again.

🔄 **Update:** run the same line again. Your projects stay. · 🗑️ **Uninstall:** delete the folder.

<details><summary>Without the installer (developers)</summary>

```bash
git clone https://github.com/oliverhees/open-motion.git
cd open-motion
npm install
npx hyperframes browser ensure
pip install faster-whisper requests
npm run editor:build
npm start                        # → http://localhost:4317
```

</details>

---

## 🅰️ Way A: subscription in the editor (chat, comments, graphics)

✅ **The installer already set this up** if it found Claude Code or Codex.

1. Open the editor → **⚙ Settings**.
2. Under **AI model** pick **Claude Code (subscription, no key)** or **Codex (subscription, no key)**.
3. Leave the model empty to use the CLI's default, or enter e.g. `opus` / `sonnet`.
4. **Save** → 🩺 **Test now**.

✅ AI chat, comments ("@AI …") and "graphics from transcript" now use your subscription.

**Good to know**

- 🔒 The CLI gets **no tools** (Claude Code: all off; Codex: read-only). It only returns the change, and Open Motion validates it.
- 💳 If `ANTHROPIC_API_KEY` is set, Open Motion does **not** pass it to `claude`, so the subscription is always used.
- 🖼️ **AI images** still need an image key (Kie.ai, OpenAI, OpenRouter or Gemini). Without one, let the AI draw SVG graphics.
- 🎙️ **Transcript:** local with faster-whisper, no key.

---

## 🅱️ Way B: MCP (the AI builds the video for you)

Open Motion includes an MCP server at **`http://localhost:4317/mcp`**. It starts with Open Motion.

✅ **The installer already did this.** You only need the entries below without the installer.

### Claude Code

```bash
claude mcp add --transport http openmotion http://localhost:4317/mcp
```

### Codex

Add to `~/.codex/config.toml` (adjust the path):

```toml
[mcp_servers.openmotion]
command = "node"
args = ["/home/YOU/open-motion/packages/server/src/mcp-stdio.ts"]
env = { OPENMOTION_URL = "http://localhost:4317" }
```

`mcp-stdio.ts` is a small bridge that forwards everything to the running server, so any client that speaks MCP over stdio works.

### Hermes

Add to `~/.hermes/config.yaml` (adjust the path):

```yaml
mcp_servers:
  openmotion:
    command: "node"
    args: ["/home/YOU/open-motion/packages/server/src/mcp-stdio.ts"]
    env:
      OPENMOTION_URL: "http://localhost:4317"
```

If your Hermes version supports MCP over HTTP, `url: "http://localhost:4317/mcp"` works too.

### 🎬 Example: explainer from an existing facecam recording

> Use Open Motion. Create the project "AI tools explained". Import `/home/me/Videos/facecam.mp4` as facecam in the "corner" layout. Transcribe in English. Cut filler words and long pauses. Add a short title for every key statement, anchored to the matching word. Then give me the editor link.

**Or as a motion designer, from scratch:**

> Use Open Motion. Make a 20-second 9:16 reel about our new café opening. Interview me first, suggest 3 directions, then build it. Look at your frames and fix everything below 8/10, then export 1080p.

The AI follows a director workflow built into the MCP: brief → three directions → style and format → beat sheet → build → **look at its own frames** (`look`) and fix → export.

Open the link. **Every change the AI makes shows up live in the editor within about 2 seconds**, with the notice "Updated from outside".

### 🔧 Tools

| Tool | What it does |
| --- | --- |
| `list_projects`, `create_project` | See and create projects (with format 16:9 / 9:16 / 1:1 / 4:5 and a style) |
| `list_styles` | The 14 styles with fonts, palette and motion rules |
| `get_project`, `get_spec` | Overview or the full Motion-Spec |
| `spec_reference` | The master prompt: design laws, engine reference (text animation, masks, counters, drawing, 3D, camera, textures), recipes, self-check |
| `import_media` | Copy a file from your computer into the project (videos are converted if needed) |
| `add_facecam` | Add a video as facecam (picture and sound separate) |
| `transcribe`, `job_status` | Start a transcript; when done it is saved into the project |
| `get_transcript` | Words with times, cuts, suggestions for filler words and pauses |
| `apply_patch` | Any change, validated (on error nothing is saved and the message says why) |
| `add_captions` | Subtitles from the transcript, matching format and style |
| `look` | Renders frames and shows them to the AI as images, so it can judge and fix its own work |
| `export_video` | Render MP4 or GIF, link via `job_status` |
| `editor_url` | Link to the project in the editor |

### 🔒 Security

- **No password** (local): the MCP only answers **on localhost**. Websites cannot drive it.
- **With a password** (server): create a token in the editor under **⚙ → Access for AIs**. Then:
  - Claude Code: `claude mcp add --transport http openmotion https://your-server/mcp --header "Authorization: Bearer om_…"`
  - Bridge: also set `OPENMOTION_TOKEN = "om_…"` in `env`.
- **Import:** `import_media` only reads from your home folder. Other folders: `OPENMOTION_IMPORT_DIRS=/path/a:/path/b`. In Docker the import is off unless you set this variable.

---

## ⚠️ What is tested

| Part | Status |
| --- | --- |
| **Installer Linux** | ✅ tested live: install, update, real Whisper transcript, MCP with Claude Code, export |
| **Installer macOS / Windows** | ⚠️ not tested on real machines; Windows download steps checked in PowerShell |
| Way A with **Claude Code** | ✅ tested live (real CLI, valid change on the example project) |
| Way A with **Codex** | ⚠️ tested with a simulated CLI only, not live |
| Way B with **Claude Code** over HTTP | ✅ tested live (create project, import and add facecam, add title) |
| Live update in the editor | ✅ tested in a real browser |
| Director workflow with `look` (Claude Code) | ✅ tested live: the README showcase was built this way, final scores 8–9 |
| Self-review in the editor chat (Claude Code) | ✅ tested live; with **Codex** not tested (Codex gets the frames via `--image`) |
| Kie MCP detection | ✅ tested with config files; Kie credits with a real key not tested |
| stdio bridge | ✅ protocol tested; **not** yet live with Codex or Hermes |
| **Hermes** | ⚠️ not tested live. If the field names differ in your version, check the Hermes docs |

**Known limitations**

- If you and the AI change the same project **at the same time**, the last save wins.
- The editor only takes over outside changes while you have nothing unsaved.
