<p align="center">
  <b>English</b> · <a href="README.de.md">Deutsch</a> · <a href="README.es.md">Español</a> · <a href="README.fr.md">Français</a> · <a href="README.pt-BR.md">Português</a> · <a href="README.zh-CN.md">简体中文</a>
</p>

[![Open Motion — Every element is a layer.](docs/assets/open-motion-hero.jpg)](docs/assets/open-motion-hero.jpg)

# Open Motion

**The open-source, self-hosted motion graphics studio where every element is a live-editable layer.**

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE) [![Status](https://img.shields.io/badge/Status-Beta%200.1-orange.svg)](#-status) [![Stack](https://img.shields.io/badge/Stack-HyperFrames%20%2B%20Web%20Animations-informational.svg)](#-architecture) [![Self-hosted](https://img.shields.io/badge/Self--hosted-Docker%20%2B%20Coolify-black.svg)](docs/deploy-coolify.md) [![Tests](https://img.shields.io/badge/Tests-47%20passing-brightgreen.svg)](#-status)

*Describe your video, talk into your facecam or drop in files. The AI builds layers, you fine-tune them live, and out comes an MP4.*

[Quickstart](#-quickstart) · [Features](#-features) · [Screenshots](#-screenshots) · [Architecture](#-architecture) · [Deploy with Coolify](docs/deploy-coolify.md) · [Guide](docs/guide.md) · [License](#-license)

---

## Why Open Motion

AI video generators hand you finished pixels. If one word in the title is wrong or a graphic sits two inches too far left, you regenerate everything and hope. Classic editors give you full control, but every animation costs hours.

Open Motion takes a third path: **motion graphics as code.** Every element is its own layer with a frame, content and timing. The AI writes those layers, and you grab them directly in the editor: drag, resize, type. Rendering happens at the very end with headless Chrome and FFmpeg, frame by frame, exactly as you saw it in the preview.

On top of that you get what an explainer video needs: facecam recording in the browser, a transcript with per-word timing, graphics anchored to spoken words, and cutting right in the text. Delete a slip of the tongue, and facecam, audio and graphics shift along automatically.

## 🏆 How it compares

|  | AI video generators | Classic video editors | Open Motion |
| --- | --- | --- | --- |
| **Change a single element** | ❌ usually regenerate everything | ✅ by hand | ✅ click, type or leave an AI comment; only that element changes |
| **Swap content, keep the frame** | ❌ | ⚠️ tedious | ✅ graphic → AI image → video; position and animation stay |
| **Facecam + transcript + text-based cutting** | ❌ | ⚠️ often extra software | ✅ built in; graphics hang on words and move when you cut |
| **Choose your AI model** | ❌ vendor's model | ❌ | ✅ your own keys: Claude, OpenAI, OpenRouter; images via Kie.ai, OpenAI, OpenRouter, Gemini |
| **Self-hosted, your data stays with you** | ❌ cloud | ✅ local | ✅ Docker + Coolify, one folder per project |
| **Source code** | ❌ | ❌ mostly | ✅ AGPL-3.0 |

To be fair: describing animations as code and rendering them in a browser is not a new idea. What we add is everything that is missing when you only render: a layer model that AI **and** humans can edit at the same time, a live editor without reloads, a facecam workflow with text-based cutting, and rendering that tunes itself to your hardware.

## ✨ Features

- **Layer system:** text, shapes, drawn graphics (SVG), images, video, audio. Every layer has a frame, keyframes, easing, and enter/exit transitions.
- **Live editor:** click, drag, resize, type directly in the preview. Change something at the playhead and a keyframe is set automatically. Only changed layers are updated, so moving a video never reloads it.
- **Scene strip & tweaks:** name, length and speed per scene, plus every text of the scene at a glance.
- **AI chat:** "Make a 20-second animation for my café" → scenes, texts, graphics, images. Every answer can be undone on its own.
- **Comments on elements:** click an element, write "@AI make it green", done. Only that element changes.
- **Facecam:** record in the browser or upload, audio on its own track, layout buttons (big, corner, circle, split) with smooth transitions.
- **Transcript with word timing:** local with faster-whisper or via OpenAI, ElevenLabs, Groq, Deepgram.
- **Anchors:** graphics hang on spoken words.
- **Text-based cutting:** deleting words cuts the video. Filler words and long pauses are suggested; audio gets click-free micro fades on export.
- **AI images:** Kie.ai, OpenAI, OpenRouter or Gemini, saved locally right away.
- **Export:** MP4 or GIF, 720p or 1080p, 15/30/60 fps, optional sharper text.
- **Self-tuning rendering:** detects CPU, RAM and GPU (including container limits), plans render workers and learns from every export how long it really takes.
- **Bilingual UI:** English and German, switchable.
- **Self-hosted:** Docker image in `slim` and `whisper` variants, editor and render worker as separate services.

## 📸 Screenshots

| Live editor | AI chat |
| --- | --- |
| [![Live editor](docs/assets/editor.png)](docs/assets/editor.png) | [![AI chat](docs/assets/ai-chat.png)](docs/assets/ai-chat.png) |
| **Transcript & anchors** | **Text-based cutting** |
| [![Transcript and anchors](docs/assets/transcript-anchors.png)](docs/assets/transcript-anchors.png) | [![Text-based cutting](docs/assets/text-cut.png)](docs/assets/text-cut.png) |

<sub>The AI chat screenshot shows a staged conversation; the changes it lists were really applied to the project.</sub>

**Example video**, rendered entirely from a Motion-Spec (facecam placeholder, music, drawn graphics, an image anchored to the spoken word "image"):

![Example](docs/assets/example.gif)

## 🚀 Quickstart

**With Docker (recommended):**

```bash
git clone https://github.com/oliverhees/open-motion.git
cd open-motion
cp .env.example .env            # set OPENMOTION_PASSWORD
docker compose -f docker-compose.yml -f docker-compose.local.yml --env-file .env up --build
# → http://localhost:4317
```

**Without Docker (Node 22.18+, FFmpeg):**

```bash
npm install
npx hyperframes browser ensure  # Chrome for rendering (once)
npm run example:assets          # example files (needs Python + Pillow)
npm run editor:build
npm start                       # → http://localhost:4317
```

Then: ⚙ Settings → add your API keys → 🩺 **Test now**.

**On your server:** [Step-by-step Coolify guide](docs/deploy-coolify.md)

## 🧩 Architecture

```
Browser (editor)                         Server
┌────────────────────────────┐          ┌───────────────────────────────────────────┐
│ Preview (real composition  │  patches │ app      editor, API, login, AI agent      │
│ in an iframe, hot updates) │ ───────► │          project folders, autosave, chat   │
│ Stage: click, drag, type,  │          │                 │ queue (plain files)      │
│ comments                   │          │                 ▼                          │
│ AI chat, tweaks, media     │          │ worker   export (HyperFrames + Chrome)     │
└────────────────────────────┘          │          transcription (Whisper / API)     │
                                         └───────────────────────────────────────────┘
```

**The core** is the **Motion-Spec**, a JSON file with scenes and layers. Editor, AI and renderer only read and write this file. Changes go exclusively through **patches** such as `set`, `setAt` (auto-keyframe), `swap` (swap content, keep the frame) or `cut` (text-based cutting). Every patch is validated, and errors come back in plain language, so an AI can correct itself.

**Stack:** [HyperFrames](https://github.com/heygen-com/hyperframes) (Apache 2.0) renders HTML to video. Animation uses the browser's own **Web Animations API**, deliberately without GSAP, whose license forbids use in visual animation builders. Preview and export share the exact same easing functions. TypeScript runs directly in Node 22 without a build step; the editor is React + Vite.

```
packages/
  core/     Motion-Spec, schema, easing, timing, cuts, patches, compiler
  render/   HyperFrames builder, export, hardware detection, "openmotion" CLI
  server/   API, login, tokens, queue, worker, AI agent, transcription
  editor/   React UI
```

More: [Guide](docs/guide.md) · [Motion-Spec reference](docs/motion-spec.md)

## 🛡️ Security

- **Editor:** password login (`OPENMOTION_PASSWORD`). Session cookie is `HttpOnly` and `SameSite=Lax`, plus `Secure` behind HTTPS. 10 failed attempts trigger a 15-minute lock.
- **AIs and scripts:** API tokens, created in the editor, shown once, **stored only as a hash**, revocable at any time. Tokens cannot create new tokens.
- **Provider API keys** are stored with file mode 600 on the server and **never** sent back to the browser, which only sees "set …abcd".
- **CSRF protection:** every cookie-based change needs a custom header.
- **AI-drawn SVG** is sanitized: scripts, event handlers, `foreignObject` and `javascript:` links are removed.
- **Docker:** the container runs as non-root, and the app refuses to start without a password.
- **Path protection:** no file outside the project folder is reachable (tested).
- **HyperFrames telemetry** is switched off.

Found a vulnerability? See [SECURITY.md](SECURITY.md).

## 🔧 Status

**Beta 0.1, backed by 47 automated tests and end-to-end runs in headless Chrome:**

- [x] Layer core: spec, patches, compiler, render to MP4/GIF (checked frame by frame)
- [x] Live editor: drag, resize, type, auto-keyframes, scenes, comments
- [x] Facecam recording in the browser (tested with a fake camera and real speech)
- [x] Local transcription with faster-whisper
- [x] Text-based cutting with suggestions, click-free audio and anchors that follow (measured in the export)
- [x] AI agent with self-correction, comments → changes, graphics from transcript (test mode and simulated providers)
- [x] Login, API tokens, CSRF header, brute-force lock
- [x] Editor and render worker as separate processes with a shared queue
- [x] Self-tuning rendering with learning time estimates
- [ ] Live test of all AI, image and transcription APIs with real keys
- [ ] Docker build confirmed on Coolify
- [ ] MCP connector for Claude, Hermes and other agents
- [ ] Skill for claude.ai, Claude Code, Cowork and Hermes

**Known limitations:** AI, image and transcription APIs are built against the providers' docs and response formats; the live test with real keys is in progress. The Docker image follows proven patterns but still has to prove itself in your environment. Whole scenes do not follow text-based cuts yet. There is one password for everyone (no user accounts yet). Some server-side messages are still German. Videos from YouTube & co. cannot be embedded frame-accurately; import them as files.

Details: [STATUS.md](STATUS.md)

## 🗺️ Roadmap

1. **MCP connector:** Claude (web, Code, Cowork), Hermes and other agents build videos directly on your server and send you the editor link.
2. **Skill:** design rules, a spec cheat sheet and examples, so any AI builds good motion graphics.
3. **Scenes anchored to words:** whole scenes follow text-based cuts.
4. **Pro timeline:** tracks, keyframe curves, audio tracks.

## 📜 License

The core (Motion-Spec, compiler, editor, server, worker) is licensed under the **[GNU Affero General Public License v3.0 (AGPL-3.0)](LICENSE)**, an OSI-approved open-source license. Free to use, modify and share. Copyleft: if you modify Open Motion and offer it as a network service, you must publish your modified source code as well.

**Building blocks:** HyperFrames (Apache 2.0), React (MIT), Zod (MIT), faster-whisper (MIT, optional). The example font Bricolage Grotesque is licensed under the SIL Open Font License. **No GSAP.**

## 🏠 Don't want to self-host?

You can run Open Motion entirely on your own infrastructure ([Coolify guide](docs/deploy-coolify.md)): your servers, your data, no middleman. If you'd rather not set it up yourself, **we can run a dedicated instance for you.** One instance per customer, no shared pool. Contact: [aiianer.de](https://aiianer.de) or [Issues](https://github.com/oliverhees/open-motion/issues).

## 🤝 Contributing

Issues, pull requests and discussions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, tests and PR expectations, and our [Code of Conduct](CODE_OF_CONDUCT.md). The most important rule: spec changes go through patches, and new features come with tests (see [CLAUDE.md](CLAUDE.md)).

Project management runs exclusively through [GitHub Issues](https://github.com/oliverhees/open-motion/issues).

---

<p align="center">Made with ❤️ and passion by <b>Oliver Hees – Der Aiianer</b> · <a href="https://aiianer.de">aiianer.de</a> · <a href="LICENSE">AGPL-3.0</a></p>
