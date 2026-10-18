# Open Motion guide

*[Deutsches Handbuch](de/handbuch.md)*

## 🧱 The idea in one sentence

**Everything is a layer. Every layer is frame + content + time.** Editor, AI and renderer read and write the same JSON file, the [Motion-Spec](motion-spec.md). Rendering happens only at export.

## 🎛️ Editor

- **Stage:** click selects, drag moves, corners resize (Shift keeps the aspect ratio), the center snaps.
- **Text:** double-click or Enter, then type directly in the preview.
- **Auto-keyframes:** if a property is animated, changing it at the playhead sets a keyframe there. The ◆ next to each value starts an animation.
- **Scene strip & tweaks:** name, length, speed and all texts of the scene.
- **Layers:** hide, lock, move up or down, delete, swap content.
- **Style:** palette and background, live.
- **Comments:** press C, click an element, write your note; tick "Send to AI" to let the AI handle it.
- **Undo/redo, autosave, version history** (one snapshot per minute, last 50).

**Shortcuts:** Space play · C comment mode · Enter edit text · arrows 1 px (Shift 10 px) · Delete remove layer · Ctrl/Cmd+Z undo · Ctrl/Cmd+Shift+Z redo · Esc deselect

## 🎥 Media (tab "Media")

- **Record** camera + mic in the browser; the server converts WebM to seekable MP4.
- **Upload** via button or drag & drop onto the stage; files are sorted into `assets/images|video|audio|fonts`.
- **Facecam = 2 layers:** muted video + audio on its own track. Layout buttons (big right, corner, circle, split, full) set a keyframe at the playhead.
- **Transcript** with word timing: local faster-whisper (`pip install faster-whisper`) or OpenAI, ElevenLabs Scribe, Groq, Deepgram.
- **Anchors:** select a layer, switch on ⚓, click a word.
- **Text-based cutting:** switch on ✂, click a word, shift-click to extend, press Delete. Click a struck-through word to restore it. Suggestions find filler words and pauses ≥ 0.7 s (shortened to 0.3 s).

## ✦ AI

- **Chat** on the left: describe a video or ask for changes. Changed layers flash; every answer has its own Undo.
- **Work through comments:** handles all comments marked "Send to AI", one by one.
- **Graphics from transcript:** titles, keywords and SVG graphics anchored to the spoken words.
- **AI image** on any image, shape or graphic layer: enter a prompt, click Generate.
- The AI only writes **patches**; every answer is validated, errors go back to the model (up to 3 attempts). Images are generated only after the patch is valid (max 4 per answer).

| Purpose | Providers (own key, ⚙ Settings) | Default model (changeable) |
| --- | --- | --- |
| AI | Anthropic (Claude), OpenAI, OpenRouter | `claude-sonnet-5-5`, `gpt-5`, `anthropic/claude-sonnet-5.5` |
| Images | Kie.ai, OpenAI, OpenRouter, Google Gemini | `gpt-image-2-text-to-image`, `gpt-image-1`, `google/gemini-2.5-flash-image`, `gemini-2.5-flash-image` |

**Test mode without keys:** `OPENMOTION_FAKE_AI=1 npm start`.

**🔑 No API key, use your subscription:** **Claude Code** and **Codex** also work as AI providers. Open Motion then runs the logged-in CLI on your computer (without Docker only). And through the **MCP server** (`/mcp`) Claude Code, Codex and Hermes drive Open Motion directly. Guide: [Claude Code, Codex, Hermes](mcp.md).

## 📦 Export & rendering

- MP4 or GIF, 720p/1080p, 15/30/60 fps, quality, optional sharper text (renders at 2×).
- The worker detects CPU cores, free RAM and GPU (container-aware), plans the number of Chrome workers per export and learns real render speed in `data/render-stats.json`.
- Manual override: `OPENMOTION_RENDER_WORKERS=4`, `OPENMOTION_RENDER_GPU=0|1`.

## 🛠️ CLI

```bash
openmotion validate spec.json
openmotion describe spec.json                 # compact map for AI models
openmotion compile  spec.json -o build/
openmotion render   spec.json -o video.mp4 [--height 720] [--fps 30] [--quality high|medium|low] [--format mp4|gif] [--sharp]
openmotion patch    spec.json ops.json
```

Without a global install: `node packages/render/src/cli.ts …`

## 📁 Data folder

```
data/
  projects/<id>/   project.json, spec.json, comments.json, chat.json, assets/, renders/, history/
  settings.json    settings + API keys (mode 600)
  tokens.json      API tokens (hashes only)
  sessions.json    sign-ins (hashes only)
  queue/           queue between editor and worker
  worker.json      worker heartbeat
  render-stats.json, diagnose.txt, logs/
```

## 🩺 Troubleshooting

- ⚙ Settings → 🩺 **Test now** checks every key with a tiny request plus the model names, and suggests valid ones. "Copy report" gives you a report **without keys**.
- `npm run check:keys` does the same in the terminal.
- `OPENMOTION_DEBUG=1` writes every API response (without headers or keys) to `data/logs/`.
