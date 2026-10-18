# Project status

October 2026 · Beta 0.1

## ✅ Done and tested

| Block | Content | How it was verified |
| --- | --- | --- |
| 1 Layer core | Spec, schema, patches, compiler, render MP4/GIF | 20+ unit tests, renders checked frame by frame |
| 2 Live editor | Drag, resize, type, auto-keyframes, scenes, comments, export dialog | Headless Chrome run, export contains editor changes |
| 3a Facecam & media | Recording, upload, conversion, layouts, transcription (local + 4 APIs), anchors | Fake camera + real speech, local Whisper |
| 3b Text-based cutting | Cuts, suggestions, click-free audio, anchors that follow | Measured in the export (facecam ends exactly at 9.72 s) |
| 4 AI | Chat, comments → changes, graphics from transcript, 4 image providers | Test mode + simulated provider responses |
| Rendering | Hardware detection, worker planning, learning estimates | Unit tests + real render |
| Docker | Login, API tokens, queue, app + worker separated | Two real processes end-to-end |
| AI without key | Claude Code and Codex CLI as AI providers (your subscription) | Claude Code live; Codex with a simulated CLI |
| Installer | One line for Linux, macOS, Windows: Node, FFmpeg, Whisper, start icon, AI tools connected | Linux end to end (install, update, Whisper, MCP, export); macOS/Windows not on real machines |
| MCP | MCP server at /mcp + stdio bridge, live update in the editor | Claude Code live over HTTP, real browser; Codex/Hermes not live yet |
| AI director | Master prompt, 14 styles, interview form, voice input, follow-up questions as forms, self-review with rendered frames (editor + MCP `look`) | Claude Code live (showcase in the README built this way); Codex review not live |
| Motion engine 2 | Text by word/letter/line, highlight + marker, counters, SVG drawing, masks/iris, 3D tilt, blur, camera, glow/shadow/glass, textures, springs, formats 16:9/9:16/1:1/4:5, captions, Google Fonts stored locally | Unit tests + MP4 exports checked frame by frame |
| Kie AI | Key with credit display, Kie MCP detection in Claude Code/Codex/Hermes/OpenCode | Config-file tests; real key not tested |
| Brand kit | Logo, colors, fonts (Google or own files), tagline/website/handle, logo bug; several brands, default for new videos, switch per project with exact restore | Unit tests + real browser (create, upload, apply, switch off, switch again) |
| Templates | 25 scenes and overlays in the project's format, style and brand; template patch op; MCP list/add_template; live preview | Browser layout check: 25 templates × 14 styles × 4 formats, with default and with overlong texts (scripts/template-fit.ts) |
| Export | WebM/MOV with alpha (background areas detected), Lottie beta with warnings | Alpha checked in the decoded files; Lottie compared frame by frame in lottie-web (scripts/lottie-frames.ts) |
| OpenCode | CLI provider, installer MCP entry, MCP detection | Simulated CLI; installer entry tested live on Linux; real login not tested |

## 🔄 In progress

- [ ] Live test of the AI, image and transcription APIs with real keys
- [ ] Confirm Docker build and deployment on Coolify

## 🗺️ Next

- [ ] Live test of Codex (subscription + MCP) and Hermes (MCP)
- [ ] MCP on claude.ai web and Cowork (OAuth)
- [ ] Skill (SKILL.md) for motion design with Open Motion
- [ ] Scenes anchored to words (scenes follow text-based cuts)
- [ ] Pro timeline (tracks, keyframe curves, audio tracks)
- [ ] User accounts instead of one password
- [ ] Translate remaining server messages

## ⚠️ Known limitations

See [README → Status](README.md#-status).
