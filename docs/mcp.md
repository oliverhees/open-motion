# 🤖 Open Motion with Claude Code, Codex and Hermes

Two ways, both **without an API key**, using your subscription:

| Way | What happens | Use it when |
| --- | --- | --- |
| **A: Subscription in the editor** | The editor's AI chat runs `claude` or `codex` on your computer | You work in the editor |
| **B: MCP** | Claude Code, Codex or Hermes drive Open Motion from outside | You tell the AI in your terminal what to build |

Both run **on your own computer, without Docker**. The CLIs are not available inside Docker.

---

## 🧰 Setup (once)

1. Install **Node 22.18+**, **FFmpeg** and **Python 3**.
2. Get Open Motion and start it:

   ```bash
   git clone https://github.com/oliverhees/open-motion.git
   cd open-motion
   npm install
   npx hyperframes browser ensure   # Chrome for the export
   pip install faster-whisper       # free local transcription
   npm run editor:build
   npm start                        # → http://localhost:4317
   ```

3. Install the CLI and **log in once**:

   | Tool | Install | Log in |
   | --- | --- | --- |
   | Claude Code | `npm install -g @anthropic-ai/claude-code` | `claude`, then `/login` |
   | Codex | `npm install -g @openai/codex` | `codex login` |
   | Hermes | see the Hermes docs | see the Hermes docs |

---

## 🅰️ Way A: subscription in the editor (chat, comments, graphics)

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

Open Motion includes an MCP server at **`http://localhost:4317/mcp`**. It starts with `npm start`.

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

Open the link. **Every change the AI makes shows up live in the editor within about 2 seconds**, with the notice "Updated from outside".

### 🔧 Tools

| Tool | What it does |
| --- | --- |
| `list_projects`, `create_project` | See and create projects |
| `get_project`, `get_spec` | Overview or the full Motion-Spec |
| `spec_reference` | Rules, layer types, all patch operations |
| `import_media` | Copy a file from your computer into the project (videos are converted if needed) |
| `add_facecam` | Add a video as facecam (picture and sound separate) |
| `transcribe`, `job_status` | Start a transcript; when done it is saved into the project |
| `get_transcript` | Words with times, cuts, suggestions for filler words and pauses |
| `apply_patch` | Any change, validated (on error nothing is saved and the message says why) |
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
| Way A with **Claude Code** | ✅ tested live (real CLI, valid change on the example project) |
| Way A with **Codex** | ⚠️ tested with a simulated CLI only, not live |
| Way B with **Claude Code** over HTTP | ✅ tested live (create project, import and add facecam, add title) |
| Live update in the editor | ✅ tested in a real browser |
| stdio bridge | ✅ protocol tested; **not** yet live with Codex or Hermes |
| **Hermes** | ⚠️ not tested live. If the field names differ in your version, check the Hermes docs |

**Known limitations**

- If you and the AI change the same project **at the same time**, the last save wins.
- The editor only takes over outside changes while you have nothing unsaved.
