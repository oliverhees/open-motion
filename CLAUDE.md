# CLAUDE.md – notes for AI agents working in this repo

## What this is

Open Motion: motion graphics as code. Every element is a layer (frame + content + timing) in a JSON file, the **Motion-Spec**. Editor, AI and renderer only operate on it.

## Map

```
packages/core/src     types, schema (zod), ease, timing, cuts, transitions, evaluate, patch, compile, presets, describe
packages/render/src   build (HyperFrames project), render (export), hardware (planning + learning), cli
packages/server/src   server (routes), auth, queue, worker, store, settings, media, transcribe, diagnose, ai/{agent,llm,images}
packages/editor/src   App, Editor, Stage, preview (hot update), Panel, MediaTab, ChatPanel, dialogs, i18n
examples/explainer    example spec + assets
docs/                 guide, spec reference, Coolify deploy; docs/de = German versions
```

## Commands

```bash
npm test                       # required, must pass
OM_RENDER_TEST=1 npm test      # incl. a real render
npm run editor:build
OPENMOTION_FAKE_AI=1 npm start # test without keys
node scripts/screenshots.ts docs/assets   # regenerate README screenshots (English UI)
node packages/render/src/cli.ts validate|describe|render|patch …
```

## Hard rules

1. Spec changes **only** via `applyPatch` (ops in `patch.ts`). New capability = new op + test.
2. `core` stays browser-safe (no `node:` imports).
3. **No GSAP** (license). Animation = Web Animations API, easing from `ease.ts` (same curve in preview and export).
4. Word anchors and cuts use **source times of the recording**. Map with `sourceToComp`/`compToSource`.
5. Write error messages an AI can understand and fix.
6. UI strings always in `i18n.ts` for **en and de**.
7. Never log keys, tokens or passwords or send them to the browser.
8. Pin dependencies exactly, only versions ≥ 14 days old.
9. TypeScript with erasable syntax only (Node runs `.ts` directly): no `enum`, no parameter properties, imports with `.ts` extension.

## Documentation

Short sections, clear steps, emojis as anchors. Be honest: anything not tested live is labeled as such. The main README is English; translations live in `README.<lang>.md`.
