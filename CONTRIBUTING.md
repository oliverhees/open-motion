# Contributing to Open Motion

Thanks for helping! Here is everything you need for a good pull request.

## Local setup

```bash
git clone https://github.com/oliverhees/open-motion.git
cd open-motion
npm install
npx hyperframes browser ensure     # Chrome for rendering
npm run example:assets             # example files (Python + Pillow)
npm run editor:build
npm start                          # → http://localhost:4317
```

Editor with live reload: `npm start` in one terminal, `npm run editor:dev` in another (→ http://localhost:5173).

Test without API keys: `OPENMOTION_FAKE_AI=1 npm start` returns deterministic AI answers.

## Tests

```bash
npm test                     # fast, no browser (required before every PR)
OM_RENDER_TEST=1 npm test    # plus a real render
npm run smoke                # editor in headless Chrome (server must run)
npm run e2e:roles            # editor + worker as separate processes
```

## The rules

1. **The Motion-Spec only changes through patches** (`packages/core/src/patch.ts`). No direct writes, neither in the editor nor in the AI.
2. **`@openmotion/core` stays isomorphic:** no Node APIs, so it runs in the browser.
3. **No GSAP.** Animation uses the Web Animations API.
4. **New feature = new test.** Bugs get a regression test.
5. **Plain-language error messages**, so an AI can read them and correct itself.
6. **UI strings always in English and German** (`packages/editor/src/i18n.ts`).
7. **Pin dependencies exactly**, only versions at least 14 days old.
8. **Never put keys, tokens or passwords** in logs, error messages or commits.

## Pull requests

- One topic per PR, with a short description: what, why, how you tested it.
- `npm test` must pass.
- UI changes: screenshot before and after.
- Spec changes: update `docs/motion-spec.md`.

## Issues

Project management runs exclusively through [GitHub Issues](https://github.com/oliverhees/open-motion/issues). For bugs, the report from 🩺 "Test connections" helps a lot (it contains no keys).
